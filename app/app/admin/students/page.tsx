import Link from "next/link";
import { Suspense } from "react";
import AppHeader from "@/components/AppHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { AuthError, requireRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { StudentActions } from "./StudentActions";

export const metadata = { title: "Students | FaceTrackDB" };

type Search = Promise<{ q?: string | string[]; hostel?: string | string[]; status?: string | string[] }>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default function StudentsPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Students</h1>
          <Link href="/admin/students/new" className="rounded bg-black px-4 py-2 text-sm text-white dark:bg-white dark:text-black">Register student</Link>
        </div>
        <Suspense fallback={<p className="mt-4 text-sm">Loading…</p>}>
          <Content searchParams={searchParams} />
        </Suspense>
      </main>
    </>
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
      `SELECT s.student_id, s.roll_no, s.name, s.room_no, h.name AS hostel, u.email, fp.n AS samples,
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

  const field = "rounded border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700";
  return (
    <>
      <form className="mb-4 mt-4 flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col gap-1 text-xs">Search (SRN, name, email)
          <input name="q" defaultValue={q} className={field} maxLength={100} />
        </label>
        <label className="flex flex-col gap-1 text-xs">Hostel
          <select name="hostel" defaultValue={Number.isInteger(hostel) && hostel > 0 ? String(hostel) : ""} className={field}>
            <option value="">All</option>
            {hostels.rows.map((h) => <option key={h.hostel_id} value={h.hostel_id}>{h.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">Face enrolment
          <select name="status" defaultValue={status} className={field}>
            <option value="">All</option>
            <option value="enrolled">Enrolled</option>
            <option value="none">Not enrolled</option>
          </select>
        </label>
        <button className="rounded border border-zinc-400 px-3 py-2 text-sm">Filter</button>
        <Link href="/admin/students" className="py-2 text-sm underline">Clear</Link>
      </form>
      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">{students.rowCount} student{students.rowCount === 1 ? "" : "s"}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-300 dark:border-zinc-700">
              <th className="py-2">SRN</th><th>Name</th><th>Hostel / room</th><th>Login email</th><th>Parents</th><th>Face samples</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {students.rows.map((r) => (
              <tr key={r.student_id} className="border-b border-zinc-200 align-top dark:border-zinc-800">
                <td className="py-2">{r.roll_no}</td>
                <td>{r.name}</td>
                <td>{r.hostel}{r.room_no ? ` · ${r.room_no}` : ""}</td>
                <td className="break-all">{r.email}</td>
                <td>{r.parents || "–"}</td>
                <td>{r.samples > 0 ? `${r.samples} (enrolled)` : "0 (not enrolled)"}</td>
                <td><StudentActions studentId={r.student_id} name={r.name} samples={r.samples} /></td>
              </tr>
            ))}
            {students.rowCount === 0 && <tr><td colSpan={7} className="py-6 text-center text-zinc-500">No students match.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
