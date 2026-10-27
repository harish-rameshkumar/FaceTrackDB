"use client";
import { cx } from "@/components/ui/cx";
import { AlertIcon, CheckIcon, InfoIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/Notice";
import type { Feedback } from "./useLiveFeedback";

const TONE = {
  ok: "bg-success-bg text-success-text",
  warn: "bg-warning-bg text-warning-text",
  neutral: "bg-neutral-bg text-neutral-text",
} as const;

/**
 * The live camera with a framing guide (an oval to fit the face in) and one line of feedback.
 * The feedback is text plus an icon, and the oval turns green only as an extra cue. The text is
 * announced politely to screen readers when it changes.
 */
export function CameraStage({ videoRef, ready, error, feedback, overlay }: {
  videoRef: React.RefObject<HTMLVideoElement | null>; ready: boolean; error: string | null; feedback: Feedback; overlay?: React.ReactNode;
}) {
  const ok = feedback.tone === "ok";
  const Icon = feedback.tone === "ok" ? CheckIcon : feedback.tone === "warn" ? AlertIcon : InfoIcon;
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} muted playsInline aria-label="Live camera preview" className="h-full w-full -scale-x-100 object-cover" />
        <svg viewBox="0 0 100 75" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          <path fillRule="evenodd" fill="rgba(0,0,0,0.38)" d="M0 0H100V75H0Z M50 8.5C61 8.5 69 20 69 37.5S61 66.5 50 66.5 31 55 31 37.5 39 8.5 50 8.5Z" />
          <ellipse cx="50" cy="37.5" rx="19" ry="29" fill="none" stroke={ok ? "#5ddc96" : "#ffffff"} strokeWidth="0.9" strokeDasharray={ok ? undefined : "3 2"} />
        </svg>
        {!ready && !error && <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white">Starting the camera…</div>}
        {overlay}
        <p className={cx("absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium", TONE[feedback.tone])}>
          <Icon className="h-4 w-4 shrink-0" />
          <span>{feedback.text}</span>
        </p>
      </div>
      <span className="sr-only" aria-live="polite">{feedback.text}</span>
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}
