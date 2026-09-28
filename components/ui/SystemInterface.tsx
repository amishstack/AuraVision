"use client";

import type { TrackingFrame, TrackingState } from "@/types/vision";

/**
 * Layer C — system interface. Restrained perimeter modules that report
 * what the vision pipeline is doing without covering the face.
 * Public mode shows qualitative labels; debug shows the numbers.
 */

const STATE_LABEL: Record<TrackingState, string> = {
  boot: "OPTICAL INPUT — INITIALIZING",
  searching: "SEARCHING FOR FACE",
  detected: "FACE DETECTED",
  initializing: "LANDMARK FIELD — ACQUIRING",
  tracking: "FACE TRACKED",
  locked: "GEOMETRY LOCKED",
  occluded: "PARTIAL OCCLUSION",
  lost: "TRACKING LOST",
  analysis: "DEEP ANALYSIS",
  complete: "VISUAL SIGNATURE",
  error: "SYSTEM HALTED",
};

export function initStageLabel(p: number): string {
  if (p < 0.2) return "LANDMARK FIELD — 478 POINTS";
  if (p < 0.4) return "FACIAL TOPOLOGY — ACQUIRED";
  if (p < 0.6) return "DEPTH FIELD — ESTABLISHED";
  if (p < 0.85) return "GEOMETRY — SOLVED";
  return "TEMPORAL TRACK — ACQUIRING";
}

function Module({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded bg-black/35 px-2.5 py-1.5 font-mono text-[10px] font-medium leading-4 tracking-[0.12em] backdrop-blur-[2px] ${className}`}
    >
      <div className="mb-1 text-[8px] tracking-[0.2em] text-neutral-500">
        {title}
      </div>
      {children}
    </div>
  );
}

export default function SystemInterface({
  snap,
  debug,
}: {
  snap: TrackingFrame;
  debug: boolean;
}) {
  const hasFace =
    snap.state === "tracking" ||
    snap.state === "locked" ||
    snap.state === "occluded" ||
    snap.state === "analysis";

  return (
    <>
      {/* status — top left inside viewport */}
      <div className="absolute left-3 top-3 rounded bg-black/35 px-2.5 py-1.5 font-mono text-[10px] font-medium tracking-[0.15em] backdrop-blur-[2px] sm:left-4 sm:top-4 sm:tracking-[0.2em]">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              snap.state === "locked"
                ? "bg-cyan-300"
                : snap.state === "occluded" || snap.state === "lost"
                  ? "bg-amber-400"
                  : snap.state === "error"
                    ? "bg-red-400"
                    : hasFace
                      ? "bg-neutral-300"
                      : "bg-neutral-600"
            }`}
          />
          <span className="text-neutral-300">
            {snap.state === "initializing"
              ? initStageLabel(snap.initProgress)
              : STATE_LABEL[snap.state]}
          </span>
        </div>
      </div>

      {/* guided deep-analysis — instruction + checklist */}
      {snap.state === "analysis" && snap.scan && (
        <>
          <div className="absolute left-1/2 top-3 w-max max-w-[92vw] -translate-x-1/2 rounded bg-black/35 px-3 py-1.5 text-center font-mono text-[10px] font-medium tracking-[0.15em] backdrop-blur-[2px] sm:top-4 sm:tracking-[0.25em]">
            <div className="text-neutral-200">{snap.scan.instruction}</div>
            <div className="mt-1 text-[9px] text-neutral-500">
              {Math.round(snap.scanProgress * 100)}%
            </div>
            {/* FRAME phase — live candidate indicator */}
            {snap.scan.checks.filter(Boolean).length === 7 &&
              snap.frameCandidates.length > 0 && (
                <div className="mt-3 animate-[fadeIn_0.3s_ease-out] text-[9px] tracking-[0.15em]">
                  <div className="font-medium text-neutral-200">
                    FRAME CANDIDATE{" "}
                    {String(snap.frameCandidateNo).padStart(2, "0")} / 12
                  </div>
                  <div className="mt-0.5 text-[8px] text-neutral-500">
                    BEST QUALITY {snap.bestFrameQuality}%
                  </div>
                  <div className="mt-1">
                    {snap.frameCandidates[snap.frameCandidates.length - 1].isBest ? (
                      <span
                        key={snap.frameCandidateNo}
                        className="animate-[newBest_0.35s_ease-out] text-cyan-200/90"
                      >
                        NEW BEST FRAME
                      </span>
                    ) : (
                      <span className="text-neutral-500">
                        BEST {snap.bestFrameQuality}%
                      </span>
                    )}
                  </div>
                </div>
              )}
          </div>

          {/* candidate history strip — sits above the checklist panel */}
          {snap.frameCandidates.length > 0 && (
            <div className="absolute bottom-[7.25rem] left-1/2 flex -translate-x-1/2 gap-1.5 sm:bottom-32">
              {snap.frameCandidates.map((c, i) => (
                <span
                  key={i}
                  className={`border bg-black/40 px-1.5 py-0.5 font-mono text-[8px] tracking-[0.1em] tabular-nums backdrop-blur-[2px] ${
                    c.isBest
                      ? "border-cyan-300/60 text-cyan-200"
                      : "border-neutral-700 text-neutral-400"
                  }`}
                >
                  {c.quality}
                </span>
              ))}
            </div>
          )}
          {/* phase checklist — translucent panel anchored to the lower zone */}
          <div className="absolute bottom-12 left-1/2 w-max max-w-[92vw] -translate-x-1/2 rounded bg-black/40 px-3 py-2 font-mono text-[9px] tracking-[0.12em] backdrop-blur-[2px] sm:bottom-14 sm:tracking-[0.2em]">
            <div className="mb-1 text-center font-medium text-neutral-400">
              DEEP ANALYSIS
            </div>
            <div className="flex max-w-[300px] flex-wrap justify-center gap-x-3 gap-y-1">
              {snap.scan.labels.map((lbl, i) => (
                <span
                  key={lbl}
                  className={
                    snap.scan!.checks[i]
                      ? "text-neutral-300"
                      : i === snap.scan!.checks.filter(Boolean).length
                        ? "text-cyan-200/90"
                        : "text-neutral-600"
                  }
                >
                  {lbl}
                  {snap.scan!.checks[i] ? " ✓" : ""}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {/* pose + gaze modules — bottom edge, off the face */}
      {hasFace && (
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between sm:bottom-4 sm:left-4 sm:right-4">
          {/* HEAD POSE */}
          <Module title="HEAD POSE">
            <div className="flex items-center gap-2">
              {/* orientation dot indicator */}
              <span className="relative inline-block h-6 w-6 rounded-full border border-neutral-700">
                <span
                  className="absolute left-1/2 top-1/2 h-1 w-1 rounded-full bg-neutral-300"
                  style={{
                    transform: `translate(-50%,-50%) translate(${
                      clamp(snap.pose?.yawDeg ?? 0, -30, 30) * 0.3
                    }px, ${-clamp(snap.pose?.pitchDeg ?? 0, -30, 30) * 0.3}px)`,
                  }}
                />
              </span>
              {debug && snap.pose ? (
                <span className="text-neutral-400 tabular-nums">
                  Y{fmt(snap.pose.yawDeg)}&nbsp; P{fmt(snap.pose.pitchDeg)}&nbsp; R{fmt(snap.pose.rollDeg)}
                </span>
              ) : (
                <span className="text-neutral-400">
                  {poseSummary(snap.pose?.yawDeg ?? 0, snap.pose?.pitchDeg ?? 0)}
                </span>
              )}
            </div>
          </Module>

          {/* GAZE + TRACK */}
          <div className="flex items-end gap-5">
            <Module title="GAZE">
              <div className="text-neutral-300">
                {snap.gaze ? snap.gaze.label : "—"}
              </div>
            </Module>
            <Module title="TEMPORAL TRACK">
              <div className="text-neutral-300">
                {snap.occluded
                  ? "DEGRADED"
                  : snap.metrics.stability > 0.55
                    ? "STABLE"
                    : "UNSTABLE"}
                {debug && (
                  <span className="ml-2 text-neutral-600 tabular-nums">
                    {(snap.metrics.stability * 100).toFixed(0)}%
                  </span>
                )}
              </div>
            </Module>
          </div>
        </div>
      )}
    </>
  );
}

function fmt(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}°`;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function poseSummary(yaw: number, pitch: number): string {
  if (Math.abs(yaw) > 25) return yaw > 0 ? "RIGHT PROFILE" : "LEFT PROFILE";
  if (Math.abs(pitch) > 20) return pitch > 0 ? "ELEVATED" : "LOWERED";
  if (Math.abs(yaw) > 10) return yaw > 0 ? "RIGHT" : "LEFT";
  return "FRONTAL";
}
