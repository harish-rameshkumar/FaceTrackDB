"use client";

import { useState } from "react";
import StateMessage from "@/components/StateMessage";
import { postJson, useFetch } from "@/components/useApi";

type LeaveRequest = {
  id: number;
  studentName: string;
  rollNo: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  decidedByName: string | null;
};

const BADGE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-900",
  approved: "bg-green-100 text-green-900",
  rejected: "bg-red-100 text-red-900",
};

export default function ParentLeave() {
  const { data, error, status, loading, reload } = useFetch<{ requests: LeaveRequest[] }>("/api/leave");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);

  async function decide(id: number, decision: "approved" | "rejected") {
    setBusyId(id);
    setRowError(null);
    const result = await postJson(`/api/leave/${id}/decide`, { decision });
    setBusyId(null);
    if (!result.ok) {
      setRowError({ id, message: result.error ?? "Request failed" });
    }
    reload(); // show the latest state, also after a conflict
  }

  if (loading) return <p>Loading...</p>;
  if (error) return <StateMessage status={status} error={error} />;
  if (!data || data.requests.length === 0) {
    return <p className="text-sm text-gray-500">There are no leave requests for your wards.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {data.requests.map((r) => (
        <li key={r.id} className="rounded border border-gray-300 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold">
                {r.studentName} <span className="font-normal text-gray-500">({r.rollNo})</span>
              </p>
              <p className="text-sm">
                {r.startDate} to {r.endDate}
              </p>
              <p className="mt-1 text-sm">{r.reason}</p>
            </div>
            <span className={`rounded px-2 py-0.5 text-sm ${BADGE[r.status]}`}>{r.status}</span>
          </div>

          {r.status === "pending" ? (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busyId === r.id}
                onClick={() => decide(r.id, "approved")}
                className="rounded bg-green-700 px-3 py-1 text-sm text-white disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busyId === r.id}
                onClick={() => decide(r.id, "rejected")}
                className="rounded bg-red-700 px-3 py-1 text-sm text-white disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-500">Decided by {r.decidedByName ?? "a parent"}</p>
          )}

          {rowError?.id === r.id && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {rowError.message}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
