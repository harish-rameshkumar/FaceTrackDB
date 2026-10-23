import { authErrorResponse, requireRole } from "@/lib/auth-stub";
import { getPool } from "@/lib/db";
import { callInSavepoint, classify, getThresholds, mapProcedureError, searchNearest, toConfidence } from "@/lib/matching";
import { toDescriptor } from "@/lib/vectors";

interface MatchBody {
  descriptor?: unknown;
  camera_id?: unknown;
  purpose?: unknown;
  direction?: unknown;
}

export async function POST(request: Request) {
  try {
    await requireRole(["security", "admin"]);

    let body: MatchBody;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Body must be JSON" }, { status: 400 });
    }
    const vector = toDescriptor(body.descriptor);
    if (!vector) return Response.json({ error: "descriptor must be 128 finite numbers" }, { status: 400 });
    const cameraId = body.camera_id;
    if (typeof cameraId !== "number" || !Number.isInteger(cameraId) || cameraId <= 0) {
      return Response.json({ error: "camera_id must be a positive integer" }, { status: 400 });
    }
    if (body.purpose !== "attendance" && body.purpose !== "entry_exit") {
      return Response.json({ error: "purpose must be 'attendance' or 'entry_exit'" }, { status: 400 });
    }
    const purpose = body.purpose;
    if (body.direction !== undefined && body.direction !== "IN" && body.direction !== "OUT") {
      return Response.json({ error: "direction must be 'IN' or 'OUT'" }, { status: 400 });
    }

    const thresholds = getThresholds();
    const pool = getPool();

    const cam = await pool.query<{ gate_id: number; hostel_id: number; status: string }>(
      `SELECT c.gate_id, g.hostel_id, c.status
       FROM cameras c JOIN gates g ON g.gate_id = c.gate_id
       WHERE c.camera_id = $1`,
      [cameraId],
    );
    if (cam.rowCount === 0) return Response.json({ error: "Camera not found" }, { status: 404 });
    if (cam.rows[0].status !== "active") return Response.json({ error: "Camera is not active" }, { status: 409 });
    const { gate_id: gateId, hostel_id: hostelId } = cam.rows[0];

    const { top, runnerUp } = await searchNearest(vector);
    const distance = top ? top.distance : null;
    const outcome = classify(top, runnerUp, thresholds);
    const studentId = outcome === "no_match" ? null : top!.studentId;
    // gap to the nearest face of a different student (null if there is none)
    const margin = top && runnerUp ? runnerUp.distance - top.distance : null;
    const confidence = toConfidence(distance);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
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
        distance,
        confidence,
        margin,
        thresholds: { match_max_distance: thresholds.matchMax, review_max_distance: thresholds.reviewMax, margin_min: thresholds.marginMin },
        student,
      };

      // Only a confident match touches attendance or the gate log.
      if (outcome !== "matched" || studentId === null) {
        await client.query("COMMIT");
        return Response.json({ ...base, result: null });
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
          return Response.json(
            { ...base, result: null, error: { code: "no_active_session", message: "No roll call is open for this hostel right now" } },
            { status: 409 },
          );
        }
        const sessionId = sess.rows[0].session_id;
        const call = await callInSavepoint(client, () =>
          client.query<{ p_status: string }>("CALL mark_attendance($1, $2, $3, NULL)", [studentId, sessionId, eventId]),
        );
        await client.query("COMMIT");
        if (call.ok) {
          return Response.json({ ...base, result: { kind: "attendance", session_id: sessionId, status: call.value.rows[0].p_status } });
        }
        return procedureFailure(base, call.error);
      }

      // purpose === 'entry_exit': default direction is the opposite of the last gate event
      let direction = body.direction as "IN" | "OUT" | undefined;
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
        return Response.json({ ...base, result: { kind: "entry_exit", direction, log_id: r.p_log_id, violation_type: r.p_violation_type } });
      }
      return procedureFailure(base, call.error);
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    const auth = authErrorResponse(e);
    if (auth) return auth;
    console.error("match failed", e);
    return Response.json({ error: "Matching failed" }, { status: 500 });
  }
}

function procedureFailure(base: Record<string, unknown>, error: unknown): Response {
  const mapped = mapProcedureError(error);
  if (!mapped) {
    console.error("procedure failed", error);
    return Response.json({ ...base, result: null, error: { code: "internal", message: "Could not record this scan" } }, { status: 500 });
  }
  // The face event was kept (savepoint); only the attendance/gate write was refused.
  return Response.json({ ...base, result: null, error: { code: mapped.code, message: mapped.message } }, { status: mapped.status });
}
