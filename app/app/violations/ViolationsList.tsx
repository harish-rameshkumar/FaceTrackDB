"use client";

import { useState } from "react";
import StateMessage from "@/components/StateMessage";
import { postJson, useFetch } from "@/components/useApi";

type Violation = {
  id: number;
  studentName: string;
  rollNo: string;
  type: "late_return" | "missed_attendance" | "no_leave";
  details: string | null;
  raisedAt: string;
  status: "open" | "resolved";
  resolvedByEmail: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  late_return: "Late return",
  missed_attendance: "Missed attendance",
  no_leave: "Left without leave",
};

export default function ViolationsList() {
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("all");
  const url = filter === "all" ? "/api/violations" : `/api/violations?status=${filter}`;
  const { data, error, status, loading, reload } = useFetch<{
    canResolve: boolean;
    violations: Violation[];
  }>(url);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);

  async function resolve(id: number) {
    setBusyId(id);
    setRowError(null);
    const result = await postJson(`/api/violations/${id}/resolve`);
    setBusyId(null);
    if (!result.ok) {
      setRowError({ id, message: result.error ?? "Request failed" });
    }
    reload();
  }

  if (error) return <StateMessage status={status} error={error} />;
  if (loading && !data) return <p>Loading...</p>;

  const canResolve = data?.canResolve ?? false;
  const violations = data?.violations ?? [];

  return (
    <div className="flex flex-col gap-4">
      {canResolve && (
        <label className="flex items-center gap-2 text-sm">
          Show
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as "all" | "open" | "resolved")}
            className="rounded border border-gray-400 bg-transparent px-2 py-1"
          >
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
          </select>
        </label>
      )}

      {violations.length === 0 ? (
        <p className="text-sm text-gray-500">No violations to show.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {violations.map((v) => (
            <li key={v.id} className="rounded border border-gray-300 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{TYPE_LABEL[v.type] ?? v.type}</p>
                  <p className="text-sm">
                    {v.studentName} <span className="text-gray-500">({v.rollNo})</span>
                  </p>
                  <p className="text-sm text-gray-500">{v.raisedAt.slice(0, 16)}</p>
                  {v.details && <p className="mt-1 text-sm">{v.details}</p>}
                </div>
                <span
                  className={`rounded px-2 py-0.5 text-sm ${
                    v.status === "open" ? "bg-red-100 text-red-900" : "bg-green-100 text-green-900"
                  }`}
                >
                  {v.status}
                </span>
              </div>

              {v.status === "open" && canResolve && (
                <button
                  type="button"
                  disabled={busyId === v.id}
                  onClick={() => resolve(v.id)}
                  className="mt-3 rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
                >
                  Mark resolved
                </button>
              )}
              {v.status === "resolved" && v.resolvedByEmail && (
                <p className="mt-2 text-sm text-gray-500">Resolved by {v.resolvedByEmail}</p>
              )}
              {rowError?.id === v.id && (
                <p role="alert" className="mt-2 text-sm text-red-600">
                  {rowError.message}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
