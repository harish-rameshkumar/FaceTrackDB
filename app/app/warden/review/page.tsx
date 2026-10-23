import Link from "next/link";
import { Suspense } from "react";
import { AccessDenied } from "@/components/AccessDenied";
import { AuthError, requireRole } from "@/lib/auth-stub";
import { getPool } from "@/lib/db";
import { ReviewActions } from "./ReviewActions";

export default function ReviewPage() {
  return (
    <main className="mx-auto w-full max-w-4xl p-8">
      <Link href="/" className="text-sm underline">Home</Link>
      <h1 className="mt-2 text-2xl font-semibold">Low-confidence scans</h1>
      <p className="mb-6 mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Scans the system was not sure about. Confirm the suggested student (or pick another), or reject if nobody is recognised. Times are IST.
      </p>
      <Suspense fallback={<p className="text-sm">Loading…</p>}>
        <ReviewContent />
      </Suspense>
    </main>
  );
}

async function ReviewContent() {
  try {
    await requireRole(["warden", "admin"]);
  } catch (e) {
    if (e instanceof AuthError) return <AccessDenied roles={["warden", "admin"]} />;
    throw e;
  }
  const pool = getPool();
  // v_review_queue is defined in db/b_queries.sql and uses idx_face_events_review_queue
  const [queue, students] = await Promise.all([
    pool.query(
      `SELECT event_id, to_char(event_time, 'DD Mon HH24:MI:SS') AS event_time, confidence,
              hostel_id, hostel, camera_location, candidate_student_id, candidate_roll_no, candidate_name
       FROM v_review_queue ORDER BY event_time`,
    ),
    pool.query("SELECT student_id, roll_no, name, hostel_id FROM students ORDER BY roll_no"),
  ]);

  if (queue.rows.length === 0) {
    return <p className="rounded border border-dashed border-zinc-400 p-6 text-sm">Nothing to review. All scans were clear.</p>;
  }
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-zinc-300 dark:border-zinc-700">
          <th className="py-2">Event</th><th>Time (IST)</th><th>Where</th><th>Score</th><th>Candidate</th><th>Decision</th>
        </tr>
      </thead>
      <tbody>
        {queue.rows.map((r) => (
          <tr key={r.event_id} className="border-b border-zinc-200 align-top dark:border-zinc-800">
            <td className="py-2">#{r.event_id}</td>
            <td>{r.event_time}</td>
            <td>{r.hostel}<br /><span className="text-zinc-500">{r.camera_location}</span></td>
            <td>{r.confidence}</td>
            <td>{r.candidate_name ? `${r.candidate_name} (${r.candidate_roll_no})` : "–"}</td>
            <td>
              <ReviewActions
                eventId={r.event_id}
                candidateId={r.candidate_student_id}
                students={students.rows.filter((s) => s.hostel_id === r.hostel_id)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
