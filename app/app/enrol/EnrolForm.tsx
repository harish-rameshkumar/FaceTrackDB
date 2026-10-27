"use client";
import { useState } from "react";
import { CameraView, useCamera } from "@/components/CameraView";
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
      <label className="flex max-w-md flex-col gap-1 text-sm">
        Student
        <select
          className="rounded border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value === "" ? "" : Number(e.target.value))}
          disabled={busy || fixedStudentId !== undefined}
        >
          <option value="">Choose a student…</option>
          {students.map((s) => (
            <option key={s.student_id} value={s.student_id}>
              {s.roll_no} · {s.name} · {s.hostel} ({s.profiles} samples)
            </option>
          ))}
        </select>
      </label>

      <div className="relative max-w-md">
        <CameraView videoRef={videoRef} />
        {busy && step < PROMPTS.length && (
          <p className="absolute inset-x-0 bottom-0 rounded-b-lg bg-black/70 p-2 text-center text-sm text-white" role="status">
            {PROMPTS[step]}{countdown > 0 ? ` (${countdown})` : ""}
          </p>
        )}
      </div>
      {cameraError && <p className="text-sm text-red-600">{cameraError}</p>}

      <div className="flex max-w-md items-center gap-3">
        <button
          onClick={enrol}
          disabled={!ready || busy || studentId === ""}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black"
        >
          {busy ? "Capturing…" : `Capture ${PROMPTS.length} frames and ${replace ? "re-enrol" : "enrol"}`}
        </button>
        {busy && <progress value={step} max={PROMPTS.length} className="h-2 flex-1" aria-label="Capture progress" />}
      </div>
      {busy && <p className="text-sm text-zinc-600 dark:text-zinc-400">Captured {step} of {PROMPTS.length}. Follow the prompt on the video.</p>}
      {message && (
        <p className={`text-sm ${message.kind === "ok" ? "text-green-700 dark:text-green-400" : "text-red-600"}`} role="status">
          {message.text}
        </p>
      )}
      {failedFrames.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-red-600">
          {failedFrames.map((f) => (
            <li key={f.index}>Frame {f.index + 1} ({PROMPTS[f.index]}): {f.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
