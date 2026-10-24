"use client";

import { useState } from "react";
import StateMessage from "@/components/StateMessage";
import { postJson, useFetch } from "@/components/useApi";

type LeaveRequest = {
  id: number;
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

export default function StudentLeave() {
  const { data, error, status, loading, reload } = useFetch<{ requests: LeaveRequest[] }>("/api/leave");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    const result = await postJson("/api/leave", { startDate, endDate, reason });
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setStartDate("");
    setEndDate("");
    setReason("");
    reload();
  }

  if (loading) return <p>Loading...</p>;
  if (error) return <StateMessage status={status} error={error} />;

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={submit} className="flex flex-col gap-3 rounded border border-gray-300 p-4">
        <h2 className="font-semibold">Request leave</h2>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-sm">
            From
            <input
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded border border-gray-400 bg-transparent px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            To
            <input
              type="date"
              required
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded border border-gray-400 bg-transparent px-3 py-2"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          Reason
          <textarea
            required
            minLength={3}
            maxLength={500}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="rounded border border-gray-400 bg-transparent px-3 py-2"
          />
        </label>
        {formError && (
          <p role="alert" className="text-sm text-red-600">
            {formError}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="self-start rounded bg-black px-4 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {busy ? "Sending..." : "Send request"}
        </button>
      </form>

      <section>
        <h2 className="mb-2 font-semibold">My requests</h2>
        {data && data.requests.length === 0 ? (
          <p className="text-sm text-gray-500">No leave requests yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-300">
                  <th className="py-2 pr-4">Dates</th>
                  <th className="py-2 pr-4">Reason</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2">Decided by</th>
                </tr>
              </thead>
              <tbody>
                {data?.requests.map((r) => (
                  <tr key={r.id} className="border-b border-gray-200">
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {r.startDate} to {r.endDate}
                    </td>
                    <td className="py-2 pr-4">{r.reason}</td>
                    <td className="py-2 pr-4">
                      <span className={`rounded px-2 py-0.5 ${BADGE[r.status]}`}>{r.status}</span>
                    </td>
                    <td className="py-2">{r.decidedByName ?? "-"}</td>
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
