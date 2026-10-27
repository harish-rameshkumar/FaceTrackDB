import Link from "next/link";
import { Suspense } from "react";
import { AccessDenied } from "@/components/AccessDenied";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField, inputClasses } from "@/components/ui/FormField";
import { PageHeader } from "@/components/ui/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { StatusPill } from "@/components/ui/StatusPill";
import { AuthError, requireRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { StudentActions } from "./StudentActions";

export const metadata = { title: "Students | FaceTrackDB" };

type Search = Promise<{ q?: string | string[]; hostel?: string | string[]; status?: string | string[] }>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default function StudentsPage({ searchParams }: { searchParams: Search }) {
  return (
    <PageShell width="wide">
      <PageHeader title="Students" description="Register students and their parents, enrol or re-enrol faces, and delete students who have no history." actions={<Button href="/admin/students/new" variant="primary">Register student</Button>} />
      <Suspense fallback={<Spinner label="Loading students" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </PageShell>
  );
}

async function Content({ searchParams }: { searchParams: Search }) {
  try {
    await requireRole(["admin"]);
  } catch (e) {
    if (e instanceof AuthError) return <AccessDenied roles={["admin"]} />;
    throw e;
  }
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 100);
  const hostel = Number(one(sp.hostel));
  const status = one(sp.status);

  const where: string[] = [];
  const params: unknown[] = [];
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
    where.push(`(s.roll_no ILIKE $${params.length} OR s.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }
  if (Number.isInteger(hostel) && hostel > 0) {
    params.push(hostel);
    where.push(`s.hostel_id = $${params.length}`);
  }
  if (status === "enrolled") where.push("fp.n > 0");
  if (status === "none") where.push("fp.n = 0");

  const pool = getPool();
  const [hostels, students] = await Promise.all([
    pool.query("SELECT hostel_id, name FROM hostels ORDER BY name"),
    pool.query(
      `SELECT s.student_id, s.user_id, s.roll_no, s.name, s.room_no, h.name AS hostel, u.email, fp.n AS samples,
              COALESCE((SELECT string_agg(p.name || ' (' || sp.relation || ')', ', ' ORDER BY p.name)
                        FROM student_parent sp JOIN parents p USING (parent_id) WHERE sp.student_id = s.student_id), '') AS parents
       FROM students s
       JOIN hostels h ON h.hostel_id = s.hostel_id
       JOIN users u ON u.user_id = s.user_id
       CROSS JOIN LATERAL (SELECT count(*)::int AS n FROM face_profiles f WHERE f.student_id = s.student_id) fp
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY s.roll_no`,
      params,
    ),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <form method="get" aria-label="Filters" className="rounded-lg border border-border bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Search (SRN, name, email)">{(c) => <input {...c} name="q" defaultValue={q} className={inputClasses} maxLength={100} />}</FormField>
          <FormField label="Hostel">
            {(c) => (
              <select {...c} name="hostel" defaultValue={Number.isInteger(hostel) && hostel > 0 ? String(hostel) : ""} className={inputClasses}>
                <option value="">All</option>
                {hostels.rows.map((h) => <option key={h.hostel_id} value={h.hostel_id}>{h.name}</option>)}
              </select>
            )}
          </FormField>
          <FormField label="Face enrolment">
            {(c) => (
              <select {...c} name="status" defaultValue={status} className={inputClasses}>
                <option value="">All</option>
                <option value="enrolled">Enrolled</option>
                <option value="none">Not enrolled</option>
              </select>
            )}
          </FormField>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary">Filter</Button>
          <Button href="/admin/students" variant="secondary">Clear</Button>
        </div>
      </form>

      <Card title={`${students.rowCount} student${students.rowCount === 1 ? "" : "s"}`}>
        <DataTable
          caption="Students"
          rows={students.rows}
          rowKey={(r) => r.student_id}
          empty={<EmptyState title="No students match" action={<Button href="/admin/students/new" variant="primary" size="sm">Register a student</Button>}>Change the filters, or register a new student.</EmptyState>}
          columns={[
            { key: "srn", header: "SRN", render: (r) => r.roll_no, className: "whitespace-nowrap" },
            { key: "n", header: "Name", render: (r) => r.name },
            { key: "h", header: "Hostel / room", render: (r) => `${r.hostel}${r.room_no ? ` · ${r.room_no}` : ""}` },
            { key: "e", header: "Login email", render: (r) => r.email },
            { key: "p", header: "Parents", render: (r) => r.parents || "–" },
            { key: "f", header: "Face samples", render: (r) => <span className="inline-flex items-center gap-2">{r.samples} <StatusPill status={r.samples > 0 ? "matched" : "no_match"} label={r.samples > 0 ? "Enrolled" : "Not enrolled"} /></span> },
            { key: "a", header: "Actions", render: (r) => <StudentActions studentId={r.student_id} userId={r.user_id} name={r.name} samples={r.samples} /> },
          ]}
        />
        <p className="mt-3 text-xs text-muted"><Link href="/admin/students/new" className="underline">Register another student</Link></p>
      </Card>
    </div>
  );
}
