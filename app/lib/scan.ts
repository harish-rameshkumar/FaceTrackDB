import { getPool } from "./db";
import {
  callInSavepoint, classifyFrame, combineFrames, getScanCooldownSeconds, getThresholds, mapProcedureError,
  searchFrame, secondsUntilGateScanAllowed, toConfidence,
} from "./matching";

export interface ScanInput {
  embeddings: number[][]; // one per usable frame (quality already checked)
  cameraId: number;
  purpose: "attendance" | "entry_exit";
  direction?: "IN" | "OUT";
}

export interface ScanResult {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * Everything after the images have been turned into embeddings: search Qdrant per
 * frame, combine the frames, log the face event and (for a confident match) call
 * mark_attendance / record_entry_exit in the same transaction. Pure data in, plain
 * result out, so the tests can call it without a browser or the embedder.
 */
export async function processScan(input: ScanInput): Promise<ScanResult> {
  const { cameraId, purpose } = input;
  const thresholds = getThresholds();
  const pool = getPool();

  const cam = await pool.query<{ gate_id: number; hostel_id: number; status: string }>(
    `SELECT c.gate_id, g.hostel_id, c.status
     FROM cameras c JOIN gates g ON g.gate_id = c.gate_id
     WHERE c.camera_id = $1`,
    [cameraId],
  );
  if (cam.rowCount === 0) return { status: 404, body: { error: "Camera not found" } };
  if (cam.rows[0].status !== "active") return { status: 409, body: { error: "Camera is not active" } };
  const { gate_id: gateId, hostel_id: hostelId } = cam.rows[0];

  const verdicts = [];
  for (const embedding of input.embeddings) verdicts.push(classifyFrame(await searchFrame(embedding), thresholds));
  const decision = combineFrames(verdicts);
  const { outcome, studentId } = decision;
  const confidence = toConfidence(decision.similarity);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Gate scans only: a student identified with confidence may not be scanned again within
    // SCAN_COOLDOWN_SECONDS. The check runs first, so a rejected scan writes nothing at all
    // (no face event, no gate log, no violation) and cannot flip IN/OUT.
    if (purpose === "entry_exit" && outcome === "matched" && studentId !== null) {
      const cooldown = getScanCooldownSeconds();
      if (cooldown > 0) {
        const wait = await secondsUntilGateScanAllowed(client, studentId, cooldown);
        if (wait !== null) {
          const who = await client.query("SELECT student_id, roll_no, name FROM students WHERE student_id = $1", [studentId]);
          await client.query("ROLLBACK");
          return {
            status: 429,
            headers: { "Retry-After": String(wait) },
            body: {
              error: `Already scanned. Please wait ${wait} second${wait === 1 ? "" : "s"}.`,
              code: "scan_cooldown",
              retryAfterSeconds: wait,
              student: who.rows[0] ?? null,
            },
          };
        }
      }
    }

    const ev = await client.query<{ event_id: number; event_time: string }>(
      `INSERT INTO face_events (camera_id, student_id, confidence, outcome)
       VALUES ($1, $2, $3, $4)
       RETURNING event_id, to_char(event_time, 'YYYY-MM-DD"T"HH24:MI:SS') || '+05:30' AS event_time`,
      [cameraId, studentId, confidence, outcome],
    );
    const eventId = ev.rows[0].event_id;

    let student: { student_id: number; roll_no: string; name: string } | null = null;
    if (studentId !== null) {
      const s = await client.query("SELECT student_id, roll_no, name FROM students WHERE student_id = $1", [studentId]);
      student = s.rows[0] ?? null;
    }

    const base = {
      event_id: eventId,
      event_time: ev.rows[0].event_time,
      outcome,
      similarity: decision.similarity,
      confidence,
      margin: decision.margin,
      frames: { usable: decision.usableFrames, agreeing: decision.agreeingFrames },
      thresholds: { match_min_similarity: thresholds.matchMin, review_min_similarity: thresholds.reviewMin, min_margin: thresholds.minMargin },
      student,
    };

    // Only a confident match touches attendance or the gate log.
    if (outcome !== "matched" || studentId === null) {
      await client.query("COMMIT");
      return { status: 200, body: { ...base, result: null } };
    }

    if (purpose === "attendance") {
      const sess = await client.query<{ session_id: number }>(
        `SELECT session_id FROM attendance_sessions
         WHERE hostel_id = $1 AND session_date = current_date
           AND localtime BETWEEN start_time AND end_time
         ORDER BY start_time LIMIT 1`,
        [hostelId],
      );
      if (sess.rowCount === 0) {
        await client.query("COMMIT");
        return {
          status: 409,
          body: { ...base, result: null, error: { code: "no_active_session", message: "No roll call is open for this hostel right now" } },
        };
      }
      const sessionId = sess.rows[0].session_id;
      const call = await callInSavepoint(client, () =>
        client.query<{ p_status: string }>("CALL mark_attendance($1, $2, $3, NULL)", [studentId, sessionId, eventId]),
      );
      await client.query("COMMIT");
      if (call.ok) {
        return { status: 200, body: { ...base, result: { kind: "attendance", session_id: sessionId, status: call.value.rows[0].p_status } } };
      }
      return procedureFailure(base, call.error);
    }

    // purpose === 'entry_exit': default direction is the opposite of the last gate event
    let direction = input.direction;
    if (!direction) {
      const last = await client.query<{ direction: string }>(
        "SELECT direction FROM entry_exit_log WHERE student_id = $1 ORDER BY event_time DESC, log_id DESC LIMIT 1",
        [studentId],
      );
      direction = last.rows[0]?.direction === "OUT" ? "IN" : "OUT";
    }
    const call = await callInSavepoint(client, () =>
      client.query<{ p_log_id: number; p_violation_type: string | null }>(
        "CALL record_entry_exit($1, $2, $3, $4, NULL, NULL)",
        [studentId, gateId, eventId, direction],
      ),
    );
    await client.query("COMMIT");
    if (call.ok) {
      const r = call.value.rows[0];
      return { status: 200, body: { ...base, result: { kind: "entry_exit", direction, log_id: r.p_log_id, violation_type: r.p_violation_type } } };
    }
    return procedureFailure(base, call.error);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

function procedureFailure(base: Record<string, unknown>, error: unknown): ScanResult {
  const mapped = mapProcedureError(error);
  if (!mapped) {
    console.error("procedure failed", error);
    return { status: 500, body: { ...base, result: null, error: { code: "internal", message: "Could not record this scan" } } };
  }
  // The face event was kept (savepoint); only the attendance/gate write was refused.
  return { status: mapped.status, body: { ...base, result: null, error: { code: mapped.code, message: mapped.message } } };
}
