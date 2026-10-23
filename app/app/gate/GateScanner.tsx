"use client";
import { useEffect, useRef, useState } from "react";
import { CameraView, useCamera } from "@/components/CameraView";
import { describeFace, loadFaceApi } from "@/lib/face-client";

interface Cam { camera_id: number; location: string | null; gate: string; hostel: string }

interface ScanResponse {
  event_id?: number;
  event_time?: string;
  outcome?: "matched" | "low_confidence" | "no_match";
  score?: number | null;
  student?: { name: string; roll_no: string } | null;
  result?: { kind: string; status?: string; direction?: string; violation_type?: string | null } | null;
  error?: string | { code: string; message: string };
}

interface ScanEntry { at: string; status: number; body: ScanResponse }

export function GateScanner({ cameras }: { cameras: Cam[] }) {
  const { videoRef, ready, error: cameraError } = useCamera();
  const [cameraId, setCameraId] = useState<number | "">(cameras[0]?.camera_id ?? "");
  const [purpose, setPurpose] = useState<"entry_exit" | "attendance">("entry_exit");
  const [direction, setDirection] = useState<"auto" | "IN" | "OUT">("auto");
  const [auto, setAuto] = useState(false);
  const [modelState, setModelState] = useState<"loading" | "ready" | "failed">("loading");
  const [last, setLast] = useState<ScanEntry | null>(null);
  const [history, setHistory] = useState<ScanEntry[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const scanning = useRef(false);

  useEffect(() => {
    loadFaceApi().then(() => setModelState("ready"), () => setModelState("failed"));
  }, []);

  async function scan() {
    if (scanning.current || cameraId === "" || !videoRef.current) return;
    scanning.current = true;
    setNote(null);
    try {
      const faceapi = await loadFaceApi();
      const descriptor = await describeFace(faceapi, videoRef.current);
      if (!descriptor) {
        setNote("No face in view.");
        return;
      }
      const res = await fetch("/api/faces/match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ descriptor, camera_id: cameraId, purpose, ...(purpose === "entry_exit" && direction !== "auto" ? { direction } : {}) }),
      });
      const body: ScanResponse = await res.json();
      const entry = { at: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }), status: res.status, body };
      setLast(entry);
      setHistory((h) => [entry, ...h].slice(0, 8));
    } catch {
      setNote("Scan failed. Check the connection and try again.");
    } finally {
      scanning.current = false;
    }
  }

  useEffect(() => {
    if (!auto || !ready || modelState !== "ready") return;
    const id = setInterval(scan, 2500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, ready, modelState, cameraId, purpose, direction]);

  const field = "rounded border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">Camera
          <select className={field} value={cameraId} onChange={(e) => setCameraId(Number(e.target.value))}>
            {cameras.map((c) => <option key={c.camera_id} value={c.camera_id}>{c.hostel} · {c.gate} · {c.location ?? `camera ${c.camera_id}`}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">Purpose
          <select className={field} value={purpose} onChange={(e) => setPurpose(e.target.value as typeof purpose)}>
            <option value="entry_exit">Gate in/out</option>
            <option value="attendance">Roll call</option>
          </select>
        </label>
        {purpose === "entry_exit" && (
          <label className="flex flex-col gap-1 text-sm">Direction
            <select className={field} value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
              <option value="auto">Automatic (opposite of last)</option>
              <option value="IN">IN</option>
              <option value="OUT">OUT</option>
            </select>
          </label>
        )}
      </div>

      <CameraView videoRef={videoRef} />
      {cameraError && <p className="text-sm text-red-600">{cameraError}</p>}
      {modelState === "loading" && <p className="text-sm">Loading face model…</p>}
      {modelState === "failed" && <p className="text-sm text-red-600">Face model failed to load.</p>}

      <div className="flex items-center gap-4">
        <button onClick={scan} disabled={!ready || modelState !== "ready"} className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black">Scan now</button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-scan every 2.5 s
        </label>
      </div>
      {note && <p className="text-sm text-zinc-600 dark:text-zinc-400">{note}</p>}

      {last && <ResultCard entry={last} />}

      {history.length > 1 && (
        <div>
          <h2 className="mb-1 text-sm font-semibold">Recent scans</h2>
          <ul className="text-sm text-zinc-600 dark:text-zinc-400">
            {history.slice(1).map((h, i) => <li key={i}>{h.at} · {describe(h)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function describe(e: ScanEntry): string {
  const b = e.body;
  const who = b.student ? `${b.student.name}` : "unknown";
  if (typeof b.error === "object" && b.error) return `${who}: ${b.error.message}`;
  if (typeof b.error === "string") return b.error;
  if (b.outcome === "matched" && b.result?.kind === "entry_exit") return `${who} ${b.result.direction}${b.result.violation_type ? ` (violation: ${b.result.violation_type})` : ""}`;
  if (b.outcome === "matched" && b.result?.kind === "attendance") return `${who} marked ${b.result.status}`;
  return `${who}: ${b.outcome}`;
}

function ResultCard({ entry }: { entry: ScanEntry }) {
  const b = entry.body;
  const err = typeof b.error === "object" ? b.error : null;
  const tone = err || entry.status >= 400 ? "border-red-500" : b.outcome === "matched" ? "border-green-600" : b.outcome === "low_confidence" ? "border-amber-500" : "border-zinc-400";
  return (
    <div className={`max-w-md rounded-lg border-2 p-4 ${tone}`} role="status">
      <p className="text-lg font-semibold">{b.student ? `${b.student.name} (${b.student.roll_no})` : b.outcome === "no_match" ? "Not recognised" : "Error"}</p>
      <p className="text-sm">
        {b.outcome ?? "–"}{typeof b.score === "number" ? ` · score ${b.score.toFixed(3)}` : ""}
      </p>
      {b.result?.kind === "entry_exit" && (
        <p className="mt-1 text-sm">Recorded <strong>{b.result.direction}</strong>{b.result.violation_type && <span className="ml-2 rounded bg-red-600 px-2 py-0.5 text-white">Violation: {b.result.violation_type}</span>}</p>
      )}
      {b.result?.kind === "attendance" && <p className="mt-1 text-sm">Roll call: <strong>{b.result.status}</strong></p>}
      {b.outcome === "low_confidence" && <p className="mt-1 text-sm">Sent to the warden for review.</p>}
      {err && <p className="mt-1 text-sm text-red-600">{err.message}</p>}
      {typeof b.error === "string" && <p className="mt-1 text-sm text-red-600">{b.error}</p>}
      <p className="mt-1 text-xs text-zinc-500">{entry.at} IST{b.event_id ? ` · event #${b.event_id}` : ""}</p>
    </div>
  );
}
