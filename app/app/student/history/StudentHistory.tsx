"use client";

import StateMessage from "@/components/StateMessage";
import { useFetch } from "@/components/useApi";

type History = {
  summary: {
    present: number;
    lowConfidence: number;
    absent: number;
    total: number;
    attendedPercent: number | null;
  };
  currentStatus: "inside" | "outside" | null;
  attendance: {
    date: string;
    startTime: string;
    endTime: string;
    status: "present" | "absent" | "low_confidence";
    markedAt: string | null;
  }[];
  gate: { id: number; direction: "IN" | "OUT"; time: string; gateName: string }[];
};

const STATUS_BADGE: Record<string, string> = {
  present: "bg-green-100 text-green-900",
  low_confidence: "bg-yellow-100 text-yellow-900",
  absent: "bg-red-100 text-red-900",
};

const STATUS_LABEL: Record<string, string> = {
  present: "present",
  low_confidence: "present (low confidence)",
  absent: "absent",
};

export default function StudentHistory() {
  const { data, error, status, loading } = useFetch<History>("/api/history");

  if (loading) return <p>Loading...</p>;
  if (error || !data) return <StateMessage status={status} error={error} />;

  const { summary, currentStatus, attendance, gate } = data;

  return (
    <div className="flex flex-col gap-8">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Attended" value={summary.attendedPercent === null ? "-" : `${summary.attendedPercent}%`} />
        <Card label="Present" value={String(summary.present)} />
        <Card label="Low confidence" value={String(summary.lowConfidence)} />
        <Card label="Absent" value={String(summary.absent)} />
      </section>

      <p className="text-sm">
        Right now you are{" "}
        {currentStatus === "inside" && <strong>inside the hostel</strong>}
        {currentStatus === "outside" && <strong>outside the hostel</strong>}
        {currentStatus === null && <span className="text-gray-500">not recorded yet (no gate events)</span>}
        {currentStatus !== null && " (from your last gate event)."}
      </p>

      <section>
        <h2 className="mb-2 font-semibold">Roll-call attendance</h2>
        {attendance.length === 0 ? (
          <p className="text-sm text-gray-500">No attendance records yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-300">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Roll call</th>
                  <th className="py-2 pr-4">Result</th>
                  <th className="py-2">Marked at</th>
                </tr>
              </thead>
              <tbody>
                {attendance.map((a) => (
                  <tr key={`${a.date}-${a.startTime}`} className="border-b border-gray-200">
                    <td className="py-2 pr-4 whitespace-nowrap">{a.date}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {a.startTime.slice(0, 5)} to {a.endTime.slice(0, 5)}
                    </td>
                    <td className="py-2 pr-4">
                      <span className={`rounded px-2 py-0.5 ${STATUS_BADGE[a.status]}`}>
                        {STATUS_LABEL[a.status]}
                      </span>
                    </td>
                    <td className="py-2 whitespace-nowrap">{a.markedAt ? a.markedAt.slice(11, 16) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Gate entries and exits</h2>
        {gate.length === 0 ? (
          <p className="text-sm text-gray-500">No gate events yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-300">
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Direction</th>
                  <th className="py-2">Gate</th>
                </tr>
              </thead>
              <tbody>
                {gate.map((g) => (
                  <tr key={g.id} className="border-b border-gray-200">
                    <td className="py-2 pr-4 whitespace-nowrap">{g.time.slice(0, 16)}</td>
                    <td className="py-2 pr-4">{g.direction === "IN" ? "Came in" : "Went out"}</td>
                    <td className="py-2">{g.gateName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-gray-300 p-3">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
