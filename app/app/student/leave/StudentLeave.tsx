"use client";

import { useState } from "react";
import StateMessage from "@/components/StateMessage";
import { postJson, useFetch } from "@/components/useApi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField, inputClasses } from "@/components/ui/FormField";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { StatusPill } from "@/components/ui/StatusPill";

type LeaveRequest = {
  id: number;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  decidedByName: string | null;
};

export default function StudentLeave() {
  const { data, error, status, loading, reload } = useFetch<{ requests: LeaveRequest[] }>("/api/leave");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null); // the request the dialog is about
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

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

  async function confirmCancel() {
    if (!cancelling) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/leave/${cancelling.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCancelError(body.error ?? "Could not cancel the request");
        reload(); // it may have been decided meanwhile: show the latest state
        return;
      }
      setCancelling(null);
      reload();
    } catch {
      setCancelError("Could not reach the server");
    } finally {
      setCancelBusy(false);
    }
  }

  if (loading && !data) return <Spinner label="Loading leave requests" />;
  if (error) return <StateMessage status={status} error={error} />;

  return (
    <div className="flex flex-col gap-6">
      <Card title="Request leave" description="A parent of yours approves or rejects it. Approved leave means no late-return or leaving violations for those days.">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="From">
              {(c) => <input {...c} type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClasses} />}
            </FormField>
            <FormField label="To">
              {(c) => <input {...c} type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClasses} />}
            </FormField>
          </div>
          <FormField label="Reason" hint="3 to 500 characters">
            {(c) => <textarea {...c} required minLength={3} maxLength={500} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClasses} />}
          </FormField>
          {formError && <Notice tone="danger">{formError}</Notice>}
          <div><Button type="submit" variant="primary" loading={busy}>{busy ? "Sending…" : "Send request"}</Button></div>
        </form>
      </Card>

      <Card title="My requests" description="You can cancel a request while it is pending. Once a parent has decided it, it can no longer be changed.">
        <DataTable
          caption="My leave requests"
          rows={data?.requests ?? []}
          rowKey={(r) => r.id}
          empty={<EmptyState title="No leave requests yet">Use the form above to send your first one.</EmptyState>}
          columns={[
            { key: "d", header: "Dates", render: (r) => `${r.startDate} to ${r.endDate}`, className: "whitespace-nowrap" },
            { key: "r", header: "Reason", render: (r) => r.reason },
            { key: "s", header: "Status", render: (r) => <StatusPill status={r.status} /> },
            { key: "b", header: "Decided by", render: (r) => r.decidedByName ?? "–" },
            {
              key: "a", header: "", render: (r) =>
                r.status === "pending" ? <Button variant="link" onClick={() => { setCancelError(null); setCancelling(r); }}>Cancel request</Button> : null,
            },
          ]}
        />
      </Card>

      <ConfirmDialog
        open={cancelling !== null}
        title="Cancel this leave request?"
        confirmLabel="Cancel request"
        cancelLabel="Keep it"
        tone="danger"
        busy={cancelBusy}
        error={cancelError}
        onConfirm={confirmCancel}
        onCancel={() => setCancelling(null)}
      >
        {cancelling && <p>Leave from {cancelling.startDate} to {cancelling.endDate} will be removed. This cannot be undone, and a parent will not see it any more.</p>}
      </ConfirmDialog>
    </div>
  );
}
