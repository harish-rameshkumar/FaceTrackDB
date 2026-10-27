"use client";

import { useState } from "react";
import StateMessage from "@/components/StateMessage";
import { postJson, useFetch } from "@/components/useApi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { StatusPill } from "@/components/ui/StatusPill";

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

/** Leave requests of the parent's wards. `onlyPending` shows just the ones waiting for a decision. */
export default function ParentLeave({ onlyPending = false }: { onlyPending?: boolean }) {
  const { data, error, status, loading, reload } = useFetch<{ requests: LeaveRequest[] }>(onlyPending ? "/api/leave?status=pending" : "/api/leave");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);

  async function decide(id: number, decision: "approved" | "rejected") {
    setBusyId(id);
    setRowError(null);
    const result = await postJson(`/api/leave/${id}/decide`, { decision });
    setBusyId(null);
    if (!result.ok) setRowError({ id, message: result.error ?? "Request failed" });
    reload(); // show the latest state, also after a conflict
  }

  if (loading && !data) return <Spinner label="Loading leave requests" />;
  if (error) return <StateMessage status={status} error={error} />;
  if (!data || data.requests.length === 0) {
    return <EmptyState title={onlyPending ? "Nothing is waiting for you" : "No leave requests"}>{onlyPending ? "When a ward asks for leave, it appears here for you to approve or reject." : "There are no leave requests for your wards."}</EmptyState>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {data.requests.map((r) => (
        <Card as="li" key={r.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold">
                {r.studentName} <span className="font-normal text-muted">({r.rollNo})</span>
              </p>
              <p className="text-sm">{r.startDate} to {r.endDate}</p>
              <p className="mt-1 text-sm text-muted">{r.reason}</p>
            </div>
            <StatusPill status={r.status} />
          </div>

          {r.status === "pending" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" size="sm" loading={busyId === r.id} onClick={() => decide(r.id, "approved")}>Approve</Button>
              <Button variant="danger" size="sm" disabled={busyId === r.id} onClick={() => decide(r.id, "rejected")}>Reject</Button>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">Decided by {r.decidedByName ?? "a parent"}. A decision is final.</p>
          )}

          {rowError?.id === r.id && <Notice tone="danger" className="mt-3">{rowError.message}</Notice>}
        </Card>
      ))}
    </ul>
  );
}
