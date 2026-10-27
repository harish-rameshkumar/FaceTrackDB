"use client";
import { useEffect, useRef, useState } from "react";
import { captureFrame } from "@/lib/capture";

export type Feedback =
  | { key: "starting"; tone: "neutral"; text: string }
  | { key: "checking"; tone: "neutral"; text: string }
  | { key: "ok"; tone: "ok"; text: string }
  | { key: "motion"; tone: "warn"; text: string }
  | { key: "no_face" | "multiple_faces" | "low_score" | "too_small" | "too_blurry"; tone: "warn"; text: string }
  | { key: "unavailable"; tone: "neutral"; text: string };

const TEXT: Record<string, string> = {
  no_face: "No face found. Face the camera in good light.",
  multiple_faces: "More than one face in view. One person at a time.",
  low_score: "Look straight at the camera.",
  too_small: "Move closer to the camera.",
  too_blurry: "The image is blurry. Hold still.",
};

const MOTION_LIMIT = 9; // mean brightness change (0-255) between two small snapshots that counts as "moving"
const MOTION_EVERY_MS = 350;
const CHECK_EVERY_MS = 1500;

/**
 * Live hints while the camera is open: "hold still" from a cheap motion measure in the browser,
 * and "no face / move closer / blurry..." from POST /api/faces/check (the same quality gate the
 * server applies to real captures). It never captures for enrolment or scanning, and it pauses
 * (`enabled` false) while a capture or scan is running. The motion limit has not been tuned on a
 * real webcam: see docs/test-results.md.
 */
export function useLiveFeedback(videoRef: React.RefObject<HTMLVideoElement | null>, ready: boolean, enabled: boolean): Feedback {
  const [server, setServer] = useState<Feedback>({ key: "checking", tone: "neutral", text: "Checking the picture…" });
  const [moving, setMoving] = useState(false);
  const inFlight = useRef(false);

  // motion: compare tiny greyscale snapshots
  useEffect(() => {
    if (!ready || !enabled) return;
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 24;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let prev: Uint8ClampedArray | null = null;
    const id = setInterval(() => {
      const v = videoRef.current;
      if (!v || !ctx || v.readyState < 2) return;
      ctx.drawImage(v, 0, 0, 32, 24);
      const px = ctx.getImageData(0, 0, 32, 24).data;
      const grey = new Uint8ClampedArray(32 * 24);
      for (let i = 0; i < grey.length; i++) grey[i] = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3;
      if (prev) {
        let sum = 0;
        for (let i = 0; i < grey.length; i++) sum += Math.abs(grey[i] - prev[i]);
        setMoving(sum / grey.length > MOTION_LIMIT);
      }
      prev = grey;
    }, MOTION_EVERY_MS);
    return () => clearInterval(id);
  }, [ready, enabled, videoRef]);

  // quality: ask the server about one frame now and then
  useEffect(() => {
    if (!ready || !enabled) return;
    let cancelled = false;
    async function probe() {
      const v = videoRef.current;
      if (inFlight.current || !v || cancelled) return;
      inFlight.current = true;
      try {
        const form = new FormData();
        form.append("frames", await captureFrame(v), "probe.jpg");
        const res = await fetch("/api/faces/check", { method: "POST", body: form });
        if (cancelled) return;
        if (!res.ok) {
          setServer({ key: "unavailable", tone: "neutral", text: "Live hints are unavailable right now. You can still capture." });
        } else {
          const json = await res.json();
          if (json.ok) setServer({ key: "ok", tone: "ok", text: "Good. Hold still and start." });
          else setServer({ key: json.code, tone: "warn", text: TEXT[json.code] ?? "Adjust your position." } as Feedback);
        }
      } catch {
        if (!cancelled) setServer({ key: "unavailable", tone: "neutral", text: "Live hints are unavailable right now. You can still capture." });
      } finally {
        inFlight.current = false;
      }
    }
    probe();
    const id = setInterval(probe, CHECK_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ready, enabled, videoRef]);

  if (!ready) return { key: "starting", tone: "neutral", text: "Starting the camera…" };
  if (!enabled) return { key: "checking", tone: "neutral", text: "Working…" };
  if (moving) return { key: "motion", tone: "warn", text: "Hold still." };
  return server;
}
