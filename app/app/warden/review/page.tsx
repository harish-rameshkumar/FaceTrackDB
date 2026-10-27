import { Suspense } from "react";
import { AccessDenied } from "@/components/AccessDenied";
import { PageShell } from "@/components/PageShell";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { StatusPill } from "@/components/ui/StatusPill";
import { AuthError, requireRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { ReviewActions } from "./ReviewActions";

export const metadata = { title: "Review scans | FaceTrackDB" };

export default function ReviewPage() {
  return (
    <PageShell width="wide">
      <PageHeader
        title="Low-confidence scans"
        description="Scans the system was not sure about (similarity is the cosine similarity of the face; higher means a closer match). Confirm the suggested student, or pick another, or reject if nobody is recognised. Times are IST."
      />
      <Suspense fallback={<Spinner label="Loading the review queue" />}>
        <ReviewContent />
      </Suspense>
    </PageShell>
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

  return (
    <DataTable
      caption="Scans waiting for review"
      rows={queue.rows}
      rowKey={(r) => r.event_id}
      empty={<EmptyState title="Nothing to review">All scans were clear.</EmptyState>}
      columns={[
        { key: "e", header: "Event", render: (r) => <>#{r.event_id}</> },
        { key: "t", header: "Time (IST)", render: (r) => r.event_time, className: "whitespace-nowrap" },
        { key: "w", header: "Where", render: (r) => <>{r.hostel}<br /><span className="text-muted">{r.camera_location}</span></> },
        { key: "s", header: "Similarity", render: (r) => <><StatusPill status="review" /> <span className="ml-1">{r.confidence}</span></> },
        { key: "c", header: "Candidate", render: (r) => (r.candidate_name ? `${r.candidate_name} (${r.candidate_roll_no})` : "–") },
        {
          key: "d", header: "Decision", render: (r) => (
            <ReviewActions eventId={r.event_id} candidateId={r.candidate_student_id} students={students.rows.filter((s) => s.hostel_id === r.hostel_id)} />
          ),
        },
      ]}
    />
  );
}
