"use client";
import { useState } from "react";
import { CameraStage } from "@/components/camera/CameraStage";
import { useLiveFeedback } from "@/components/camera/useLiveFeedback";
import { useCamera } from "@/components/useCamera";
import { Button } from "@/components/ui/Button";
import { FormField, inputClasses } from "@/components/ui/FormField";
import { Notice } from "@/components/ui/Notice";
import { captureFrame, sleep } from "@/lib/capture";

interface Student { student_id: number; roll_no: string; name: string; hostel: string; profiles: number }

// Five frames over several seconds, each with an on-screen prompt so the samples
// cover slightly different head poses.
const PROMPTS = [
  "Look straight at the camera",
  "Turn your head slightly to the left",
  "Turn your head slightly to the right",
  "Look straight, chin a little up",
  "Look straight and relax",
];
const SECONDS_PER_PROMPT = 2;

interface FrameReport { index: number; ok: boolean; message?: string }

export function EnrolForm({ students, fixedStudentId, replace = false }: { students: Student[]; fixedStudentId?: number; replace?: boolean }) {
  const { videoRef, ready, error: cameraError } = useCamera();
  const [studentId, setStudentId] = useState<number | "">(fixedStudentId ?? "");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0); // number of frames captured so far
  const [countdown, setCountdown] = useState(0);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [failedFrames, setFailedFrames] = useState<FrameReport[]>([]);
  const feedback = useLiveFeedback(videoRef, ready, !busy);

  async function enrol() {
    if (studentId === "" || !videoRef.current) return;
    setBusy(true);
    setMessage(null);
    setFailedFrames([]);
    setStep(0);
    try {
      const frames: Blob[] = [];
      for (let i = 0; i < PROMPTS.length; i++) {
        for (let s = SECONDS_PER_PROMPT; s > 0; s--) {
          setCountdown(s);
          await sleep(1000);
        }
        frames.push(await captureFrame(videoRef.current));
        setStep(i + 1);
      }
      setCountdown(0);
      const form = new FormData();
      form.append("student_id", String(studentId));
      if (replace) form.append("replace", "1");
      frames.forEach((f, i) => form.append("frames", f, `frame${i}.jpg`));
      const res = await fetch("/api/faces/enrol", { method: "POST", body: form });
      const json = await res.json();
      if (res.status === 422 && Array.isArray(json.frames)) {
        setFailedFrames((json.frames as FrameReport[]).filter((f) => !f.ok));
        setMessage({ kind: "error", text: "Some frames were not usable, so nothing was saved. Fix the points below and try again." });
      } else if (!res.ok) {
        setMessage({ kind: "error", text: json.error ?? "Enrolment failed" });
      } else {
        setMessage({ kind: "ok", text: `Enrolled ${json.profiles.length} face samples.` });
      }
    } catch {
      setMessage({ kind: "error", text: "Enrolment failed. Check the connection and try again." });
    } finally {
      setBusy(false);
      setCountdown(0);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {fixedStudentId === undefined && (
        <div className="max-w-md">
          <FormField label="Student">
            {(c) => (
              <select {...c} className={inputClasses} value={studentId} onChange={(e) => setStudentId(e.target.value === "" ? "" : Number(e.target.value))} disabled={busy}>
                <option value="">Choose a student…</option>
                {students.map((s) => (
                  <option key={s.student_id} value={s.student_id}>
                    {s.roll_no} · {s.name} · {s.hostel} ({s.profiles} samples)
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </div>
      )}

      <CameraStage
        videoRef={videoRef}
        ready={ready}
        error={cameraError}
        feedback={feedback}
        overlay={
          busy && step < PROMPTS.length ? (
            <p className="absolute inset-x-3 top-3 rounded-md bg-black/80 px-3 py-2 text-center text-base font-semibold text-white" role="status">
              {PROMPTS[step]}{countdown > 0 ? ` (${countdown})` : ""}
            </p>
          ) : null
        }
      />

      <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={enrol} disabled={!ready || studentId === ""} loading={busy}>
            {busy ? "Capturing…" : `Capture ${PROMPTS.length} frames and ${replace ? "re-enrol" : "enrol"}`}
          </Button>
          {busy && <progress value={step} max={PROMPTS.length} className="h-2 min-w-24 flex-1" aria-label="Capture progress" />}
        </div>
        {busy && <p className="text-sm text-muted">Captured {step} of {PROMPTS.length}. Follow the prompt on the video.</p>}
        {message && <Notice tone={message.kind === "ok" ? "success" : "danger"}>{message.text}</Notice>}
        {failedFrames.length > 0 && (
          <ul className="list-disc pl-5 text-sm text-danger">
            {failedFrames.map((f) => (
              <li key={f.index}>Frame {f.index + 1} ({PROMPTS[f.index]}): {f.message}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
