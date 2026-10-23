"use client";
import { useState } from "react";
import { CameraView, useCamera } from "@/components/CameraView";
import { describeFace, loadFaceApi } from "@/lib/face-client";

interface Student { student_id: number; roll_no: string; name: string; hostel: string; profiles: number }

const FRAMES = 4;

export function EnrolForm({ students }: { students: Student[] }) {
  const { videoRef, ready, error: cameraError } = useCamera();
  const [studentId, setStudentId] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function enrol() {
    if (studentId === "" || !videoRef.current) return;
    setBusy(true);
    setMessage(null);
    setProgress(0);
    try {
      const faceapi = await loadFaceApi();
      const descriptors: number[][] = [];
      let attempts = 0;
      while (descriptors.length < FRAMES && attempts < FRAMES * 6) {
        attempts++;
        const d = await describeFace(faceapi, videoRef.current);
        if (d) {
          descriptors.push(d);
          setProgress(descriptors.length);
          await new Promise((r) => setTimeout(r, 700)); // let the person shift slightly between frames
        } else {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
      if (descriptors.length < 3) {
        setMessage({ kind: "error", text: "Could not see a face clearly. Face the camera in good light and try again." });
        return;
      }
      const res = await fetch("/api/faces/enrol", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ student_id: studentId, descriptors }),
      });
      const json = await res.json();
      if (!res.ok) setMessage({ kind: "error", text: json.error ?? "Enrolment failed" });
      else setMessage({ kind: "ok", text: `Enrolled ${json.profiles.length} face samples.` });
    } catch {
      setMessage({ kind: "error", text: "Face model failed to load or run. Check that /models is reachable." });
    } finally {
      setBusy(false);
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
          disabled={busy}
        >
          <option value="">Choose a student…</option>
          {students.map((s) => (
            <option key={s.student_id} value={s.student_id}>
              {s.roll_no} · {s.name} · {s.hostel} ({s.profiles} samples)
            </option>
          ))}
        </select>
      </label>

      <CameraView videoRef={videoRef} />
      {cameraError && <p className="text-sm text-red-600">{cameraError}</p>}

      <div className="flex max-w-md items-center gap-3">
        <button
          onClick={enrol}
          disabled={!ready || busy || studentId === ""}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black"
        >
          {busy ? "Capturing…" : `Capture ${FRAMES} frames and enrol`}
        </button>
        {busy && (
          <progress value={progress} max={FRAMES} className="h-2 flex-1" aria-label="Capture progress" />
        )}
      </div>
      {busy && <p className="text-sm text-zinc-600 dark:text-zinc-400">Captured {progress} of {FRAMES}. Look at the camera and move your head slightly.</p>}
      {message && (
        <p className={`text-sm ${message.kind === "ok" ? "text-green-700 dark:text-green-400" : "text-red-600"}`} role="status">
          {message.text}
        </p>
      )}
    </div>
  );
}
