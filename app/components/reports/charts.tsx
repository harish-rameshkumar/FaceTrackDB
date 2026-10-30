"use client";
import { useId } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReportResult } from "@/lib/reports";

// Okabe-Ito palette: distinguishable with the common kinds of colour blindness, and readable on
// white and on near-black. Colour is never the only cue: series also differ by fill pattern
// (bars) or dash and marker shape (lines), are named in a legend, and the data is available as
// a table under every chart.
const COLORS = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#F0E442"];
const DASHES = ["0", "6 3", "2 3", "8 3 2 3"];
const AXIS = { fill: "var(--chart-fg)", fontSize: 12 };

type Row = Record<string, string | number | null>;
interface Series { key: string; label: string }

const LABELS: Record<string, string> = {
  matched: "Matched", low_confidence: "Low confidence (review)", no_match: "No match", IN: "IN (return)", OUT: "OUT (exit)",
  late_return: "Late return", missed_attendance: "Missed roll call", no_leave: "Left without leave",
  approved: "Approved", rejected: "Rejected", pending: "Pending",
};
const pretty = (k: string) => LABELS[k] ?? k;

function Swatch({ i, size = 14 }: { i: number; size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} aria-hidden="true" className="inline-block shrink-0">
      <defs>{pattern(`s${id}`, i)}</defs>
      <rect width={size} height={size} rx="2" fill={fill(`s${id}`, i)} stroke={COLORS[i % COLORS.length]} strokeWidth="1" />
    </svg>
  );
}

// four looks: solid, diagonal stripes, dots, cross-hatch
function pattern(pid: string, i: number) {
  const c = COLORS[i % COLORS.length];
  const kind = i % 4;
  if (kind === 0) return null;
  return (
    <pattern id={`${pid}-${i}`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform={kind === 1 ? "rotate(45)" : undefined}>
      <rect width="8" height="8" fill={c} fillOpacity="0.28" />
      {kind === 1 && <rect width="3" height="8" fill={c} />}
      {kind === 2 && <circle cx="4" cy="4" r="2" fill={c} />}
      {kind === 3 && <path d="M0 4H8M4 0V8" stroke={c} strokeWidth="1.6" />}
    </pattern>
  );
}
const fill = (pid: string, i: number) => (i % 4 === 0 ? COLORS[i % COLORS.length] : `url(#${pid}-${i})`);

function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Legend">
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5"><Swatch i={i} />{s.label}</li>
      ))}
    </ul>
  );
}

const tooltipStyle = { background: "var(--background)", color: "var(--foreground)", border: "1px solid var(--chart-grid)", borderRadius: 6, fontSize: 13 };

/** long rows -> one object per x with a column per series */
function pivot(rows: Row[], xKey: string, serKey: string, valKey: string, xLabel: (v: string) => string = String) {
  const xs: string[] = [];
  const serKeys: string[] = [];
  const data = new Map<string, Row>();
  for (const r of rows) {
    const x = String(r[xKey]), s = String(r[serKey]);
    if (!xs.includes(x)) xs.push(x);
    if (!serKeys.includes(s)) serKeys.push(s);
    const row = data.get(x) ?? { x: xLabel(x) };
    row[s] = Number(r[valKey] ?? 0);
    data.set(x, row);
  }
  // a fixed order, so the same hostel (or status) keeps the same colour and pattern on every chart
  serKeys.sort();
  return { data: xs.map((x) => data.get(x)!), series: serKeys.map((k): Series => ({ key: k, label: pretty(k) })) };
}

interface BarsProps {
  data: Row[]; series: Series[]; xTitle: string; yTitle: string; pid: string;
  stacked?: boolean; horizontal?: boolean; domain?: [number, number]; unit?: string; decimals?: number; labels?: boolean; refLine?: { value: number; label: string };
  catWidth?: number; height: number;
}

function Bars({ data, series, xTitle, yTitle, pid, stacked, horizontal, domain, unit = "", decimals, labels, refLine, catWidth = 150, height }: BarsProps) {
  const common = { data, margin: { top: 16, right: 24, left: 8, bottom: 28 } };
  const bars = series.map((s, i) => (
    <Bar key={s.key} dataKey={s.key} name={s.label} fill={fill(pid, i)} stroke={COLORS[i % COLORS.length]} strokeWidth={1} stackId={stacked ? "a" : undefined} maxBarSize={horizontal ? 36 : 120} isAnimationActive={false}>
      {labels && <LabelList dataKey={s.key} position={horizontal ? "right" : "top"} style={{ fill: "var(--chart-fg)", fontSize: 12 }} formatter={(v) => (Number(v) === 0 ? "" : `${decimals === undefined ? v : Number(v).toFixed(decimals)}${unit}`)} />}
    </Bar>
  ));
  return (
    <>
      <div style={{ height }} role="img" aria-label={`${yTitle} by ${xTitle}`}>
        <ResponsiveContainer width="100%" height="100%">
          {horizontal ? (
            <BarChart {...common} layout="vertical" margin={{ ...common.margin, right: 48 }}>
              <defs>{series.map((_, i) => pattern(pid, i))}</defs>
              <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
              <XAxis type="number" domain={domain} tick={AXIS} stroke="var(--chart-fg)" label={{ value: yTitle, position: "insideBottom", offset: -16, style: AXIS }} allowDecimals={false} />
              <YAxis type="category" dataKey="x" width={catWidth} tick={AXIS} stroke="var(--chart-fg)" interval={0} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--chart-grid)", fillOpacity: 0.4 }} />
              {refLine && <ReferenceLine x={refLine.value} stroke="#D55E00" strokeDasharray="6 3" label={{ value: refLine.label, position: "top", style: { ...AXIS, fill: "#D55E00" } }} />}
              {bars}
            </BarChart>
          ) : (
            <BarChart {...common}>
              <defs>{series.map((_, i) => pattern(pid, i))}</defs>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="x" tick={AXIS} stroke="var(--chart-fg)" interval={0} label={{ value: xTitle, position: "insideBottom", offset: -16, style: AXIS }} />
              <YAxis domain={domain} tick={AXIS} stroke="var(--chart-fg)" allowDecimals={false} label={{ value: yTitle, angle: -90, position: "insideLeft", style: AXIS }} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--chart-grid)", fillOpacity: 0.4 }} />
              {bars}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {series.length > 1 || labels === false ? <Legend series={series} /> : null}
    </>
  );
}

function marker(i: number) {
  // circle, square, triangle, diamond
  return function Dot(p: { cx?: number; cy?: number; stroke?: string; value?: unknown }) {
    const { cx, cy, stroke } = p;
    // a day on which this series has no point must not draw a marker
    if (typeof cx !== "number" || typeof cy !== "number" || !Number.isFinite(cx) || !Number.isFinite(cy) || p.value == null) return <g />;
    const k = i % 4;
    const c = stroke ?? COLORS[i % COLORS.length];
    if (k === 0) return <circle cx={cx} cy={cy} r={4} fill={c} />;
    if (k === 1) return <rect x={cx - 4} y={cy - 4} width={8} height={8} fill={c} />;
    if (k === 2) return <path d={`M${cx} ${cy - 5}L${cx + 5} ${cy + 4}L${cx - 5} ${cy + 4}Z`} fill={c} />;
    return <path d={`M${cx} ${cy - 5}L${cx + 5} ${cy}L${cx} ${cy + 5}L${cx - 5} ${cy}Z`} fill={c} />;
  };
}

function Steps({ data, series, xTitle, yTitle, height }: { data: Row[]; series: Series[]; xTitle: string; yTitle: string; height: number }) {
  return (
    <>
      <div style={{ height }} role="img" aria-label={`${yTitle} by ${xTitle}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 24, left: 8, bottom: 28 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="x" tick={AXIS} stroke="var(--chart-fg)" label={{ value: xTitle, position: "insideBottom", offset: -16, style: AXIS }} />
            <YAxis tick={AXIS} stroke="var(--chart-fg)" allowDecimals={false} label={{ value: yTitle, angle: -90, position: "insideLeft", style: AXIS }} />
            <Tooltip contentStyle={tooltipStyle} />
            {series.map((s, i) => (
              <Line key={s.key} type="stepAfter" dataKey={s.key} name={s.label} stroke={COLORS[i % COLORS.length]} strokeWidth={2.5}
                strokeDasharray={DASHES[i % 4]} dot={marker(i)} activeDot={{ r: 6 }} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Legend">
        {series.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <svg width="34" height="12" aria-hidden="true"><line x1="0" y1="6" x2="34" y2="6" stroke={COLORS[i % COLORS.length]} strokeWidth="2.5" strokeDasharray={DASHES[i % 4]} /></svg>
            {s.label}
          </li>
        ))}
      </ul>
    </>
  );
}

const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Chooses and feeds the right chart for one report. `height` is in pixels. */
export function ReportChart({ report, height }: { report: ReportResult; height: number }) {
  const pid = `c${useId().replace(/:/g, "")}`;
  const rows = report.rows as Row[];
  switch (report.key) {
    case "attendance_by_hostel_month": {
      const p = pivot(rows, "month", "hostel", "attendance_pct");
      return <Bars {...p} pid={pid} xTitle="Month" yTitle="Roll-call attendance (%)" domain={[0, 100]} unit="%" labels height={height} />;
    }
    case "violations_by_type_hostel": {
      const p = pivot(rows, "type", "hostel", "violations", (v) => pretty(v));
      return <Bars {...p} pid={pid} xTitle="Violation type" yTitle="Violations (count)" labels height={height} />;
    }
    case "cumulative_violations": {
      const p = pivot(rows, "day", "hostel", "cumulative");
      return <Steps {...p} xTitle="Date" yTitle="Violations so far (running total)" height={height} />;
    }
    case "late_return_rank": {
      // the ten students with the most late returns, whichever hostel they are in (the query lists the top ranks of each hostel)
      const top = [...rows].sort((a, b) => Number(b.late_returns) - Number(a.late_returns) || String(a.student).localeCompare(String(b.student))).slice(0, 10);
      const data = top.map((r) => ({ x: `${r.student} (${String(r.hostel).split(" ")[0]})`, "Late returns": Number(r.late_returns) }));
      return <Bars data={data} series={[{ key: "Late returns", label: "Late returns" }]} pid={pid} xTitle="Student" yTitle="Late returns (count), top 10" horizontal labels height={Math.max(height, 70 + data.length * 32)} catWidth={210} />;
    }
    case "gate_traffic_by_hour": {
      const p = pivot(rows, "hour", "direction", "crossings", (h) => String(Number(h)).padStart(2, "0"));
      return <Bars {...p} pid={pid} xTitle="Hour of day (IST, 24 h)" yTitle="Gate crossings (count)" height={height} />;
    }
    case "time_outside": {
      const sorted = [...rows].sort((a, b) => Number(a.weekday_no) - Number(b.weekday_no));
      const p = pivot(sorted, "weekday", "hostel", "avg_hours");
      p.data.sort((a, b) => WEEKDAY_ORDER.indexOf(String(a.x)) - WEEKDAY_ORDER.indexOf(String(b.x)));
      return <Bars {...p} pid={pid} xTitle="Weekday the trip started" yTitle="Average time outside (hours)" decimals={1} labels height={height} />;
    }
    case "leave_summary": {
      const p = pivot(rows, "status", "hostel", "requests", pretty);
      return <Bars {...p} pid={pid} xTitle="Decision" yTitle="Leave requests (count)" labels height={height} />;
    }
    case "recognition_outcomes": {
      const data = rows.map((r) => ({ x: `Week of ${r.week}`, matched: Number(r.matched), low_confidence: Number(r.low_confidence), no_match: Number(r.no_match) }));
      const series = ["matched", "low_confidence", "no_match"].map((k): Series => ({ key: k, label: pretty(k) }));
      return <Bars data={data} series={series} pid={pid} stacked xTitle="Week" yTitle="Face scans (count)" height={height} />;
    }
    case "similarity_distribution": {
      const p = pivot(rows, "band", "outcome", "scans");
      const order = ["matched", "low_confidence", "no_match"];
      p.series.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
      return <Bars {...p} pid={pid} stacked xTitle="Similarity band (cosine, higher = closer)" yTitle="Face scans (count)" height={height} />;
    }
    case "low_attendance_students": {
      const data = rows.map((r) => ({ x: `${r.student} (${r.roll_no})`, "Attendance (%)": Number(r.attendance_pct) }));
      return <Bars data={data} series={[{ key: "Attendance (%)", label: "Attendance (%)" }]} pid={pid} xTitle="Student" yTitle="Roll-call attendance (%)" domain={[0, 100]} unit="%" horizontal labels
        refLine={{ value: 75, label: "75% line" }} height={Math.max(height, 80 + data.length * 36)} catWidth={190} />;
    }
    case "top_words": {
      const p = pivot(rows, "word", "source", "occurrences");
      return <Bars {...p} pid={pid} stacked horizontal xTitle="Word (stemmed)" yTitle="Occurrences (count)" height={Math.max(height, 60 + p.data.length * 30)} catWidth={110} />;
    }
    default:
      return null;
  }
}
