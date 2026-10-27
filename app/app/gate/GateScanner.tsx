"use client";
import { useEffect, useRef, useState } from "react";
import { CameraStage } from "@/components/camera/CameraStage";
import { useLiveFeedback } from "@/components/camera/useLiveFeedback";
import { useCamera } from "@/components/useCamera";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormField } from "@/components/ui/FormField";
import { inputClasses } from "@/components/ui/styles";
import { AlertIcon, CheckIcon, CrossIcon, InfoIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/Notice";
import { StatusPill } from "@/components/ui/StatusPill";
import { captureFrame, sleep } from "@/lib/capture";

interface Cam { camera_id: number; location: string | null; gate: string; hostel: string }

interface ScanResponse {
  event_id?: number;
  event_time?: string;
  outcome?: "matched" | "low_confidence" | "no_match";
  similarity?: number | null;
  confidence?: number | null;
  student?: { name: string; roll_no: string } | null;
  result?: { kind: string; status?: string; direction?: string; violation_type?: string | null } | null;
  error?: string | { code: string; message: string };
  code?: string; // top-level code, e.g. "scan_cooldown" (HTTP 429)
  retryAfterSeconds?: number;
}

// While a student is in their cooldown, auto-scan waits at most this long before trying again,
// so a different student in the queue is not held up for the whole cooldown.
const AUTO_BACKOFF_MAX_SECONDS = 5;
const SCAN_FRAMES = 3;
const FRAME_GAP_MS = 300;

interface ScanEntry { at: string; status: number; body: ScanResponse }

export function GateScanner({ cameras }: { cameras: Cam[] }) {
  const { videoRef, ready, error: cameraError } = useCamera();
  const [cameraId, setCameraId] = useState<number | "">(cameras[0]?.camera_id ?? "");
  const [purpose, setPurpose] = useState<"entry_exit" | "attendance">("entry_exit");
  const [direction, setDirection] = useState<"auto" | "IN" | "OUT">("auto");
  const [auto, setAuto] = useState(false);
  const [last, setLast] = useState<ScanEntry | null>(null);
  const [history, setHistory] = useState<ScanEntry[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const scanning = useRef(false);
  const [scanBusy, setScanBusy] = useState(false); // only drives the live hints: they pause while a scan runs
  const pausedUntil = useRef(0); // auto-scan skips its ticks until this time (ms since epoch)
  const [cooldown, setCooldown] = useState<{ name: string | null; until: number } | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [cooldownTotal, setCooldownTotal] = useState(0);
  const feedback = useLiveFeedback(videoRef, ready, !scanBusy);

  async function scan(fromAuto = false) {
    if (scanning.current || cameraId === "" || !videoRef.current) return;
    if (fromAuto && Date.now() < pausedUntil.current) return;
    scanning.current = true;
    setScanBusy(true);
    setNote(null);
    try {
      // three frames about 300 ms apart; the server needs the same student on at least two
      const form = new FormData();
      for (let i = 0; i < SCAN_FRAMES; i++) {
        if (i > 0) await sleep(FRAME_GAP_MS);
        form.append("frames", await captureFrame(videoRef.current), `frame${i}.jpg`);
      }
      form.append("camera_id", String(cameraId));
      form.append("purpose", purpose);
      if (purpose === "entry_exit" && direction !== "auto") form.append("direction", direction);
      const res = await fetch("/api/faces/match", { method: "POST", body: form });
      const body: ScanResponse = await res.json();
      if (res.status === 422 && body.code === "quality") {
        // nothing usable in view (no face, several faces, blurry...): not a scan, nothing was recorded
        setNote(typeof body.error === "string" ? body.error : "No usable face in view.");
        return;
      }
      if (res.status === 429 && body.code === "scan_cooldown" && typeof body.retryAfterSeconds === "number") {
        // Not a failed or recorded scan: just tell the guard to wait, and ease off auto-scan.
        const wait = Math.max(1, body.retryAfterSeconds);
        setCooldown({ name: body.student?.name ?? null, until: Date.now() + wait * 1000 });
        setCooldownSeconds(wait);
        setCooldownTotal(wait);
        pausedUntil.current = Date.now() + Math.min(wait, AUTO_BACKOFF_MAX_SECONDS) * 1000;
        return;
      }
      setCooldown(null);
      const entry = { at: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }), status: res.status, body };
      setLast(entry);
      setHistory((h) => [entry, ...h].slice(0, 8));
    } catch {
      setNote("Scan failed. Check the connection and try again.");
    } finally {
      scanning.current = false;
      setScanBusy(false);
    }
  }

  useEffect(() => {
    if (!auto || !ready) return;
    const id = setInterval(() => scan(true), 2500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, ready, cameraId, purpose, direction]);

  // count the notice down once a second and clear it when the cooldown is over
  useEffect(() => {
    if (!cooldown) return;
    const id = setInterval(() => {
      if (Date.now() >= cooldown.until) setCooldown(null);
      else setCooldownSeconds(Math.max(1, Math.ceil((cooldown.until - Date.now()) / 1000)));
    }, 500);
    return () => clearInterval(id);
  }, [cooldown]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,32rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <CameraStage videoRef={videoRef} ready={ready} error={cameraError} feedback={feedback} />
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="primary" onClick={() => scan()} disabled={!ready} loading={scanBusy}>{scanBusy ? "Scanning…" : "Scan now"}</Button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-scan every 2.5 s
          </label>
        </div>
        {note && <Notice tone="info">{note}</Notice>}
        {cooldown && (
          <Notice tone="info" title={cooldown.name ? `${cooldown.name}: already scanned` : "Already scanned"}>
            Please wait {cooldownSeconds} second{cooldownSeconds === 1 ? "" : "s"}.
            <progress className="mt-2 block h-2 w-full" max={cooldownTotal || 1} value={Math.max(0, cooldownTotal - cooldownSeconds)} aria-label="Cooldown progress" />
          </Notice>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <Card title="Scan settings">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <FormField label="Camera">
              {(c) => (
                <select {...c} className={inputClasses} value={cameraId} onChange={(e) => setCameraId(Number(e.target.value))}>
                  {cameras.map((cam) => <option key={cam.camera_id} value={cam.camera_id}>{cam.hostel} · {cam.gate} · {cam.location ?? `camera ${cam.camera_id}`}</option>)}
                </select>
              )}
            </FormField>
            <FormField label="Purpose">
              {(c) => (
                <select {...c} className={inputClasses} value={purpose} onChange={(e) => setPurpose(e.target.value as typeof purpose)}>
                  <option value="entry_exit">Gate in/out</option>
                  <option value="attendance">Roll call</option>
                </select>
              )}
            </FormField>
            {purpose === "entry_exit" && (
              <FormField label="Direction">
                {(c) => (
                  <select {...c} className={inputClasses} value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
                    <option value="auto">Automatic (opposite of last)</option>
                    <option value="IN">IN</option>
                    <option value="OUT">OUT</option>
                  </select>
                )}
              </FormField>
            )}
          </div>
        </Card>

        <div aria-live="polite" aria-atomic="true">
          {last ? <ResultCard entry={last} /> : <Card><p className="text-sm text-muted">The result of the last scan appears here.</p></Card>}
        </div>

        {history.length > 1 && (
          <Card title="Recent scans">
            <ul className="flex flex-col gap-1 text-sm text-muted">
              {history.slice(1).map((h, i) => <li key={i}>{h.at} · {describe(h)}</li>)}
            </ul>
          </Card>
        )}
      </div>
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

// The result of one scan: colour, icon AND words, so it never relies on colour alone.
function ResultCard({ entry }: { entry: ScanEntry }) {
  const b = entry.body;
  const err = typeof b.error === "object" ? b.error : null;
  const failed = !!err || entry.status >= 400;
  const tone = failed ? "danger" : b.outcome === "matched" ? "success" : b.outcome === "low_confidence" ? "warning" : "neutral";
  const BORDER = { danger: "border-danger", success: "border-success", warning: "border-warning", neutral: "border-border" }[tone];
  const Icon = tone === "success" ? CheckIcon : tone === "danger" ? CrossIcon : tone === "warning" ? AlertIcon : InfoIcon;
  const headline = failed ? "Not recorded" : b.outcome === "matched" ? "Recognised" : b.outcome === "low_confidence" ? "Needs the warden's review" : "Not recognised";
  return (
    <div className={`rounded-lg border-2 ${BORDER} bg-surface p-4`}>
      <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide"><Icon className="h-4 w-4" />{headline}</p>
      <p className="mt-1 text-xl font-semibold">{b.student ? `${b.student.name} (${b.student.roll_no})` : b.outcome === "no_match" ? "Unknown person" : "–"}</p>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
        {b.outcome && <StatusPill status={b.outcome === "matched" ? "matched" : b.outcome === "low_confidence" ? "review" : "no_match"} />}
        {typeof b.similarity === "number" && <span className="text-muted">similarity {b.similarity.toFixed(3)}</span>}
      </p>
      {b.result?.kind === "entry_exit" && (
        <p className="mt-2 text-sm">Recorded <strong>{b.result.direction}</strong>{b.result.violation_type && <span className="ml-2 inline-flex items-center gap-1 rounded bg-danger-bg px-2 py-0.5 font-medium text-danger-text"><AlertIcon className="h-3.5 w-3.5" />Violation: {b.result.violation_type}</span>}</p>
      )}
      {b.result?.kind === "attendance" && <p className="mt-2 text-sm">Roll call: <strong>{b.result.status}</strong></p>}
      {b.outcome === "low_confidence" && <p className="mt-2 text-sm">Sent to the warden for review.</p>}
      {err && <p className="mt-2 text-sm font-medium text-danger">{err.message}</p>}
      {typeof b.error === "string" && <p className="mt-2 text-sm font-medium text-danger">{b.error}</p>}
      <p className="mt-2 text-xs text-muted">{entry.at} IST{b.event_id ? ` · event #${b.event_id}` : ""}</p>
    </div>
  );
}
