// Page-level tests for /reports and /reports/present against a running server: who can open
// them, that bad filter values are ignored, that no raw errors reach the HTML, that every
// report has a titled slide with its SQL, and that an empty range says so.
// The SQL itself is tested by db/b_reports_tests.sql.
//   BASE_URL=http://localhost:3000 npm run test:reports      (read-only: it writes nothing)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const rows: string[] = [];
let failures = 0;
const record = (name: string, expected: string, actual: string, pass: boolean) => {
  if (!pass) failures++;
  rows.push(`| ${name} | ${expected} | ${actual.replace(/\|/g, "/")} | ${pass ? "PASS" : "FAIL"} |`);
};

const dbDir = resolve(process.cwd(), "..", "db");
const seed = readFileSync(resolve(dbDir, "seed.sql"), "utf8");
const demo = readFileSync(resolve(dbDir, "demo_passwords.sql"), "utf8");
const PW = process.env.TEST_PASSWORD ?? /Password for all accounts:\s+(\S+)/.exec(demo)?.[1] ?? "";
const emailOf = (role: string) => new RegExp(`'([^']+@[^']+)'[^)\\n]*'${role}'\\)`).exec(seed)![1];
const KEYS = ["attendance_by_hostel_month", "violations_by_type_hostel", "cumulative_violations", "late_return_rank", "gate_traffic_by_hour", "time_outside", "leave_summary", "recognition_outcomes", "similarity_distribution", "low_attendance_students", "top_words"];

async function cookie(email: string): Promise<string> {
  const res = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PW }) });
  const c = res.headers.get("set-cookie");
  if (!res.ok || !c) throw new Error(`login failed for ${email}`);
  return c.split(";")[0];
}
async function page(path: string, ck: string | null): Promise<{ status: number; html: string }> {
  const res = await fetch(`${BASE}${path}`, { headers: ck ? { cookie: ck } : {} });
  return { status: res.status, html: await res.text() };
}
const RAW = /FT0\d\d|SQLSTATE|syntax error|invalid input syntax|stack trace|ECONNREFUSED|at \w+ \(/;

async function main() {
  const [warden, admin, student, parent, security] = await Promise.all(
    ["warden", "admin", "student", "parent", "security"].map((r) => cookie(emailOf(r))),
  );

  for (const path of ["/reports", "/reports/present"]) {
    const res: string[] = [];
    let ok = true;
    for (const [who, ck] of [["student", student], ["parent", parent], ["security", security], ["anonymous", null]] as const) {
      const p = await page(path, ck);
      const denied = p.html.includes("Access denied");
      res.push(`${who}:${denied ? "denied" : "OPEN"}`);
      if (!denied) ok = false;
    }
    for (const [who, ck] of [["warden", warden], ["admin", admin]] as const) {
      const p = await page(path, ck);
      const open = p.status === 200 && !p.html.includes("Access denied") && p.html.includes("SQL concept used");
      res.push(`${who}:${open ? "open" : "DENIED"}`);
      if (!open) ok = false;
    }
    record(`Access to ${path}`, "student, parent, security, anonymous denied; warden and admin open", res.join(" "), ok);
  }

  const full = await page("/reports", warden);
  const present = await page("/reports/present", warden);
  const missing = KEYS.filter((k) => !full.html.includes(`id="h-${k}"`));
  record("/reports has a section for every report", `${KEYS.length} sections`, missing.length ? `missing ${missing.join(", ")}` : `${KEYS.length} found`, missing.length === 0);
  record("Each slide states its SQL concept and has the query", "11 'SQL concept used' labels, each with a query panel",
    `${(present.html.match(/SQL concept used/g) ?? []).length} labels, ${(present.html.match(/Show query/g) ?? []).length} query panels, CREATE FUNCTION in page: ${present.html.includes("CREATE FUNCTION report_")}`,
    (present.html.match(/SQL concept used/g) ?? []).length >= KEYS.length && (present.html.match(/Show query/g) ?? []).length >= KEYS.length && present.html.includes("CREATE FUNCTION report_"));
  const sqlFile = readFileSync(resolve(dbDir, "b_reports.sql"), "utf8");
  const sample = /-- @report top_words\n([\s\S]*?)-- @end/.exec(sqlFile)![1].trim().split("\n")[3].trim();
  record("The shown query is read from db/b_reports.sql", "a line of the file appears in the page", sample.slice(0, 60), full.html.replace(/&#x27;/g, "'").replace(/&gt;/g, ">").replace(/&lt;/g, "<").includes(sample));
  record("Presentation mode has controls and slides", "Next / Previous buttons, Full screen, Print", ["Next", "Previous", "Full screen", "Print / PDF"].map((t) => `${t}:${present.html.includes(t)}`).join(" "), ["Next", "Previous", "Full screen", "Print / PDF"].every((t) => present.html.includes(t)));
  record("/reports has the filters and the presentation link", "date range, hostel, link", `from:${full.html.includes('name="from"')} to:${full.html.includes('name="to"')} hostel:${full.html.includes('name="hostel"')} link:${full.html.includes("/reports/present?")}`,
    full.html.includes('name="from"') && full.html.includes('name="to"') && full.html.includes('name="hostel"') && full.html.includes("/reports/present?"));

  // bad filter values are ignored, never an error
  const bad = ["?from=garbage&to=2026-13-45", "?from=2026-02-30&to=2026-03-01", "?hostel=abc", "?hostel=99999&from='%3B--", "?from=2026-12-31&to=2026-01-01", "?from=0001-01-01&to=9999-12-31", "?from=&to=&hostel="];
  const results: string[] = [];
  let allOk = true;
  for (const q of bad) {
    for (const path of ["/reports", "/reports/present"]) {
      const p = await page(path + q, warden);
      const ok = p.status === 200 && !RAW.test(p.html) && p.html.includes("SQL concept used");
      if (!ok) allOk = false;
      results.push(ok ? "ok" : `BAD(${q} ${path} ${p.status})`);
    }
  }
  record("Bad filter values are ignored", `${bad.length * 2} requests: HTTP 200, report page still shown, no raw error text`, `${results.filter((x) => x === "ok").length}/${results.length} ok`, allOk);
  const swapped = await page("/reports?from=2026-12-31&to=2026-01-01", warden);
  record("A backwards range is swapped, not rejected", "page shows 2026-01-01 to 2026-12-31", /2026-01-01 to 2026-12-31/.test(swapped.html) ? "shown" : "not shown", /2026-01-01 to 2026-12-31/.test(swapped.html));

  // no data: every report says so, without errors
  const empty = await page("/reports?from=2001-01-01&to=2001-01-31", warden);
  const emptyCount = (empty.html.match(/No data for this range/g) ?? []).length;
  record("An empty range says 'No data for this range'", `${KEYS.length} reports, no raw errors`, `${emptyCount} messages, raw errors: ${RAW.test(empty.html)}`, emptyCount >= KEYS.length && !RAW.test(empty.html));

  // the hostel filter changes what is shown
  const all = await page("/reports", warden);
  const hostelIds = [...all.html.matchAll(/<option value="(\d+)"/g)].map((m) => m[1]);
  const one = await page(`/reports?hostel=${hostelIds[0]}`, warden);
  record("The hostel filter narrows the data", "the page for one hostel differs from all hostels and names it", `${hostelIds.length} hostels; differs: ${one.html !== all.html}`, hostelIds.length > 0 && one.html !== all.html);

  // generated-history note
  const note = full.html.includes("Includes generated demo history");
  const hasMeta = process.env.EXPECT_HISTORY_NOTE;
  record("Generated demo history is labelled", hasMeta ? `note ${hasMeta === "1" ? "shown" : "absent"} (EXPECT_HISTORY_NOTE=${hasMeta})` : "(set EXPECT_HISTORY_NOTE=1 or 0 to assert)", `note shown: ${note}`, hasMeta ? note === (hasMeta === "1") : true);

  const emptyNote = empty.html.includes("Includes generated demo history");
  record("The generated-history note only shows for ranges that overlap it", "no note for a 2001 range", `note shown: ${emptyNote}`, !emptyNote);

  // the warden dashboard no longer has the summary cards but keeps filters and tables
  const dash = await page("/warden", warden);
  const cards = ["Students inside", "Students outside", "On approved leave today", "Open violations", "Scans waiting for review"].filter((t) => new RegExp(`<span[^>]*>${t}</span>`).test(dash.html));
  record("/warden has no summary cards, keeps filters and tables", "none of the 5 card labels; filters and 'Who is where' present", `cards: ${cards.length}, filters: ${dash.html.includes('name="presence"')}, table: ${dash.html.includes("Who is where")}`,
    cards.length === 0 && dash.html.includes('name="presence"') && dash.html.includes("Who is where"));

  console.log("| Case | Expected | Actual | Result |\n|---|---|---|---|");
  console.log(rows.join("\n"));
  console.log(`\n${rows.length - failures}/${rows.length} passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("test-reports crashed:", e instanceof Error ? e.stack : e);
  process.exit(2);
});
