"use client";

import type { TrackingFrame } from "@/types/vision";

/**
 * Toggleable diagnostics readout — inference latency, raw counts, pose
 * and expression signals. Deliberately plain; hidden in production mode.
 */
export default function DebugPanel({ snap }: { snap: TrackingFrame }) {
  const m = snap.metrics;
  const e = snap.expression;
  const p = snap.pose;

  const rows: [string, string][] = [
    ["STATE", snap.state],
    ["FACES", String(m.facesDetected)],
    ["LANDMARKS", String(m.landmarkCount)],
    ["INFERENCE", `${m.inferenceMs.toFixed(1)} ms`],
    ["FPS", m.fps.toFixed(1)],
    ["CONFIDENCE", m.confidence.toFixed(2)],
    ["STABILITY", m.stability.toFixed(2)],
    ["FRAMES W/ FACE", String(snap.framesWithFace)],
  ];
  if (p) {
    rows.push(
      ["YAW", `${p.yawDeg.toFixed(1)}°`],
      ["PITCH", `${p.pitchDeg.toFixed(1)}°`],
      ["ROLL", `${p.rollDeg.toFixed(1)}°`],
    );
  }
  if (e) {
    rows.push(
      ["BLINK L/R", `${e.blinkLeft.toFixed(2)} / ${e.blinkRight.toFixed(2)}`],
      ["SMILE", e.smile.toFixed(2)],
      ["MOUTH OPEN", e.mouthOpen.toFixed(2)],
    );
  }
  if (snap.boundingBox) {
    const b = snap.boundingBox;
    rows.push([
      "BBOX",
      `${b.x.toFixed(2)},${b.y.toFixed(2)} ${b.w.toFixed(2)}×${b.h.toFixed(2)}`,
    ]);
  }

  return (
    <div className="pointer-events-none rounded border border-neutral-800 bg-black/70 p-3 font-mono text-[10px] leading-5 tracking-wider text-neutral-400 backdrop-blur-sm">
      <div className="mb-1 text-neutral-200">DEBUG</div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-6">
          <span className="text-neutral-600">{k}</span>
          <span className="tabular-nums">{v}</span>
        </div>
      ))}
    </div>
  );
}
