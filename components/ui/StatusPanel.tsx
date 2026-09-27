"use client";

import type { TrackingFrame, TrackingState } from "@/types/vision";

/**
 * Restrained telemetry readout — mono type, dim labels, values only.
 * Reads a low-rate snapshot; never touches the render loop.
 */

const STATE_LABEL: Record<TrackingState, [string, string]> = {
  boot: ["SYSTEM READY", "LOADING VISION MODEL"],
  idle: ["SYSTEM READY", "STARTING CAMERA"],
  searching: ["SYSTEM READY", "SEARCHING FOR FACE"],
  detected: ["FACE DETECTED", "INITIALIZING LANDMARKS"],
  tracking: ["FACE TRACKED", "TRACKING ACTIVE"],
  locked: ["FACE TRACKED", "GEOMETRY LOCK"],
  error: ["SYSTEM HALTED", ""],
};

const ERROR_LABEL: Record<string, string> = {
  "permission-denied": "CAMERA ACCESS DENIED — GRANT PERMISSION AND RETRY",
  "no-camera": "NO CAMERA FOUND ON THIS DEVICE",
  "not-supported": "BROWSER DOES NOT SUPPORT CAMERA ACCESS (HTTPS REQUIRED)",
  disconnected: "CAMERA DISCONNECTED",
  "model-failed": "VISION MODEL FAILED TO LOAD",
  unknown: "UNEXPECTED CAMERA ERROR",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-200 tabular-nums">{value}</span>
    </div>
  );
}

export default function StatusPanel({ snap }: { snap: TrackingFrame }) {
  const [primary, secondary] = STATE_LABEL[snap.state];
  const active = snap.state === "tracking" || snap.state === "locked";

  return (
    <div className="pointer-events-none font-mono text-[11px] leading-5 tracking-wider">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            snap.state === "locked"
              ? "bg-cyan-300"
              : active
                ? "bg-neutral-300"
                : snap.state === "error"
                  ? "bg-red-400"
                  : "bg-neutral-600"
          }`}
        />
        <span className="text-neutral-100">{primary}</span>
      </div>
      {snap.state === "error" ? (
        <div className="mt-1 text-red-300/80">
          {ERROR_LABEL[snap.cameraError ?? "unknown"]}
        </div>
      ) : (
        <div className="mt-1 text-neutral-500">{secondary}</div>
      )}

      {active && (
        <div className="mt-4 w-52 space-y-0.5 border-t border-neutral-800 pt-3">
          <Row label="LANDMARKS" value={String(snap.metrics.landmarkCount)} />
          <Row
            label="TRACKING"
            value={snap.metrics.stability > 0.55 ? "STABLE" : "UNSTABLE"}
          />
          <Row label="FPS" value={snap.metrics.fps.toFixed(0)} />
          {snap.pose && (
            <>
              <div className="pt-2 text-neutral-500">HEAD POSE</div>
              <Row label="YAW" value={`${snap.pose.yawDeg.toFixed(1)}°`} />
              <Row label="PITCH" value={`${snap.pose.pitchDeg.toFixed(1)}°`} />
              <Row label="ROLL" value={`${snap.pose.rollDeg.toFixed(1)}°`} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
