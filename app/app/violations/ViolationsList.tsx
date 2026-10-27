"use client";

import { useState } from "react";
import StateMessage from "@/components/StateMessage";
import { postJson, useFetch } from "@/components/useApi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/ui/FormField";
import { inputClasses } from "@/components/ui/styles";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { StatusPill } from "@/components/ui/StatusPill";

type Violation = {
  id: number;
  studentName: string;
  rollNo: string;
  type: "late_return" | "missed_attendance" | "no_leave";
  details: string | null;
  raisedAt: string;
  status: "open" | "resolved";
  resolvedAt: string | null;
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
  const { data, error, status, loading, reload } = useFetch<{ canResolve: boolean; violations: Violation[] }>(url);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);

  async function resolve(id: number) {
    setBusyId(id);
    setRowError(null);
    const result = await postJson(`/api/violations/${id}/resolve`);
    setBusyId(null);
    if (!result.ok) setRowError({ id, message: result.error ?? "Request failed" });
    reload();
  }

  if (error) return <StateMessage status={status} error={error} />;
  if (loading && !data) return <Spinner label="Loading violations" />;

  const canResolve = data?.canResolve ?? false;
  const violations = data?.violations ?? [];

  return (
    <div className="flex flex-col gap-4">
      {canResolve && (
        <div className="max-w-xs">
          <FormField label="Show">
            {(c) => (
              <select {...c} value={filter} onChange={(e) => setFilter(e.target.value as "all" | "open" | "resolved")} className={inputClasses}>
                <option value="all">All</option>
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
              </select>
            )}
          </FormField>
        </div>
      )}

      {violations.length === 0 ? (
        <EmptyState title="No violations to show">Violations are raised automatically for late returns, leaving without leave and missed roll calls.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {violations.map((v) => (
            <Card as="li" key={v.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{TYPE_LABEL[v.type] ?? v.type}</p>
                  <p className="text-sm">{v.studentName} <span className="text-muted">({v.rollNo})</span></p>
                  <p className="text-sm text-muted">{v.raisedAt.slice(0, 16)}</p>
                  {v.details && <p className="mt-1 text-sm">{v.details}</p>}
                </div>
                <StatusPill status={v.status} />
              </div>

              {v.status === "open" && canResolve && (
                <Button variant="primary" size="sm" className="mt-3" loading={busyId === v.id} onClick={() => resolve(v.id)}>Mark resolved</Button>
              )}
              {v.status === "resolved" && v.resolvedByEmail && (
                <p className="mt-2 text-sm text-muted">
                  Resolved by {v.resolvedByEmail}
                  {v.resolvedAt ? ` on ${v.resolvedAt.slice(0, 16)}` : ""}
                </p>
              )}
              {rowError?.id === v.id && <Notice tone="danger" className="mt-3">{rowError.message}</Notice>}
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
