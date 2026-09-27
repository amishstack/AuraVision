"use client";

import type { TrackingFrame } from "@/types/vision";

/** Toggleable diagnostics — deliberately separated from the public UI. */
export default function DebugPanel({ snap }: { snap: TrackingFrame }) {
  const m = snap.metrics;
  const g = snap.gaze;
  const d = snap.dynamics;
  const p = snap.pose;
  const l = snap.lighting;

  const rows: [string, string][] = [
    ["STATE", snap.state],
    ["FACES", String(m.facesDetected)],
    ["LANDMARKS", String(m.landmarkCount)],
    ["RENDER FPS", m.fps.toFixed(1)],
    ["INFERENCE", `${m.inferenceMs.toFixed(1)} ms @ ${m.inferenceHz.toFixed(0)} Hz`],
    ["CONFIDENCE", m.confidence.toFixed(2)],
    ["STABILITY", m.stability.toFixed(2)],
    ["OCCLUDED", String(snap.occluded)],
    ["FRAMES W/ FACE", String(snap.framesWithFace)],
  ];
  if (p) {
    rows.push(
      ["YAW", `${p.yawDeg.toFixed(1)}°`],
      ["PITCH", `${p.pitchDeg.toFixed(1)}°`],
      ["ROLL", `${p.rollDeg.toFixed(1)}°`],
    );
  }
  if (g) {
    rows.push(
      ["GAZE", `${g.dx.toFixed(2)},${g.dy.toFixed(2)} ${g.label}`],
      ["GAZE CONF", g.confidence.toFixed(2)],
    );
  }
  if (d) {
    rows.push(
      ["EYE AP", d.eyeAperture.toFixed(2)],
      ["MOUTH AP", d.mouthAperture.toFixed(2)],
      ["SMILE", d.smile.toFixed(2)],
      ["ENERGY", d.energy.toFixed(2)],
    );
  }
  if (l) {
    rows.push(
      ["LIGHT", `${l.label}`],
      ["LUM/CON", `${l.mean.toFixed(2)} / ${l.contrast.toFixed(2)}`],
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
