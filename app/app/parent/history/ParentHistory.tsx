"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import StateMessage from "@/components/StateMessage";
import { useFetch } from "@/components/useApi";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/ui/FormField";
import { inputClasses } from "@/components/ui/styles";
import { Spinner } from "@/components/ui/Spinner";
import StudentHistory from "@/app/student/history/StudentHistory";
import type { Ward } from "../ParentHome";

/** A ward's attendance and gate history. With several wards, a selector chooses which. */
export default function ParentHistory() {
  const wards = useFetch<{ wards: Ward[] }>("/api/wards");
  const asked = Number(useSearchParams().get("student"));
  const [picked, setPicked] = useState<number | null>(null);

  if (wards.loading && !wards.data) return <Spinner label="Loading your wards" />;
  if (wards.error || !wards.data) return <StateMessage status={wards.status} error={wards.error} />;
  const list = wards.data.wards;
  if (list.length === 0) return <EmptyState title="No students are linked to your account" />;

  const current = list.find((w) => w.studentId === (picked ?? asked)) ?? list[0];
  return (
    <div className="flex flex-col gap-6">
      {list.length > 1 && (
        <div className="max-w-sm">
          <FormField label="Child">
            {(c) => (
              <select {...c} className={inputClasses} value={current.studentId} onChange={(e) => setPicked(Number(e.target.value))}>
                {list.map((w) => <option key={w.studentId} value={w.studentId}>{w.name} ({w.rollNo})</option>)}
              </select>
            )}
          </FormField>
        </div>
      )}
      <StudentHistory studentId={current.studentId} who={current.name} />
    </div>
  );
}
