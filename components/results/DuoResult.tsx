"use client";

import { useEffect, useRef } from "react";
import { MESH } from "@/lib/geometry/mesh";
import type { DuoResult as Result, Landmark } from "@/types/vision";

/**
 * Aura Duo result — dual identity contours + the session's motion
 * synchrony. Visualizes temporal alignment of real motion signals only;
 * no compatibility or relationship claims.
 */

const ACCENT = "140, 210, 240";
const WHITE = "225, 232, 240";

function drawContour(
  ctx: CanvasRenderingContext2D,
  lm: Landmark[] | null,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (!lm || lm.length < 400) return;
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const bw = Math.max(1e-4, maxX - minX);
  const bh = Math.max(1e-4, maxY - minY);
  const s = Math.min((w * 0.8) / bw, (h * 0.8) / bh);
  const ox = x + w / 2 - ((minX + maxX) / 2) * s;
  const oy = y + h / 2 - ((minY + maxY) / 2) * s;
  const P = (i: number) => ({ x: lm[i].x * s + ox, y: lm[i].y * s + oy });
  for (const [set, alpha] of [
    [MESH.faceOval, 0.75],
    [MESH.lips, 0.55],
    [MESH.leftEye, 0.55],
    [MESH.rightEye, 0.55],
    [MESH.leftBrow, 0.5],
    [MESH.rightBrow, 0.5],
    [MESH.contours, 0.14],
  ] as const) {
    ctx.strokeStyle = `rgba(${WHITE}, ${alpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const e of set) {
      const a = P(e.start);
      const b = P(e.end);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }
}

export default function DuoResult({
  result,
  fun,
  onLive,
  onRestart,
}: {
  result: Result;
  fun: boolean;
  onLive: () => void;
  onRestart: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = 300, H = 200;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const A = result.subjects[0]?.landmarks ?? null;
    const B = result.subjects[1]?.landmarks ?? null;
    drawContour(ctx, A, 10, 10, 130, 160);
    drawContour(ctx, B, 160, 10, 130, 160);

    // sync field between subjects
    const sync = result.sync.overall;
    const ax = 75, bx = 225, cy = 90;
    for (let i = 0; i < 16; i++) {
      const t = (i + 0.5) / 16;
      const xx = ax + (bx - ax) * t;
      const yy =
        cy + Math.sin(t * Math.PI * 2 + i) * 10 * (1 - sync * 0.5);
      ctx.fillStyle = `rgba(${ACCENT}, ${0.15 + sync * 0.5})`;
      ctx.beginPath();
      ctx.arc(xx, yy, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.font = "8px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = `rgba(${WHITE}, 0.6)`;
    ctx.fillText("SUBJECT A", 75, 185);
    ctx.fillText("SUBJECT B", 225, 185);
    ctx.fillText(`SYNC ${Math.round(sync * 100)}%`, 150, 40);
  }, [result]);

  const s = result.sync;
  const rows: [string, number][] = [
    ["HEAD", s.head],
    ["GAZE", s.gaze],
    ["FACIAL MOTION", s.motion],
    ["TEMPORAL ALIGNMENT", s.overall],
  ];

  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-[#0b0d0e] animate-[fadeIn_0.6s_ease-out]">
      <div className="mx-auto flex min-h-full w-full max-w-sm flex-col items-center px-6 py-6 font-mono tracking-[0.15em]">
        <div className="text-[9px] tracking-[0.3em] text-neutral-500">
          AURAVISION
        </div>
        <h1 className="mt-2 text-xl font-medium tracking-[0.2em] text-neutral-100">
          AURA DUO
        </h1>
        <div className="mt-1 text-[9px] tracking-[0.25em] text-cyan-200/80">
          DUO LOCKED — 2 SUBJECTS
        </div>

        <canvas
          ref={canvasRef}
          className="mt-5 w-full max-w-[300px] rounded border border-white/10"
          style={{ height: 200 }}
        />

        <div className="mt-5 w-full max-w-[300px] rounded border border-white/10 px-4 py-3">
          <div className="mb-2 text-[8px] tracking-[0.25em] text-neutral-500">
            MOTION SYNCHRONY
          </div>
          {rows.map(([name, v]) => (
            <div key={name} className="flex items-center gap-2 py-0.5">
              <span className="w-28 text-[9px] text-neutral-400">{name}</span>
              <div className="h-1 flex-1 bg-neutral-800">
                <div
                  className="h-1 bg-cyan-300/80"
                  style={{ width: `${Math.round(v * 100)}%` }}
                />
              </div>
              <span className="w-8 text-right text-[9px] text-neutral-400">
                {Math.round(v * 100)}%
              </span>
            </div>
          ))}
          <div className="mt-2 text-[7px] tracking-[0.2em] text-neutral-600">
            LOCAL ONLY · 2 SUBJECTS · 478 LANDMARKS / SUBJECT
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onRestart}
            className="rounded border border-white/20 px-4 py-2 text-[9px] tracking-[0.25em] text-neutral-300 transition hover:border-cyan-300/50 hover:text-cyan-200"
          >
            NEW DUO
          </button>
          <button
            onClick={onLive}
            className="rounded bg-cyan-300/10 border border-cyan-300/40 px-4 py-2 text-[9px] tracking-[0.25em] text-cyan-200 transition hover:bg-cyan-300/20"
          >
            RETURN TO LIVE
          </button>
        </div>
        {fun && (
          <div className="mt-3 text-[8px] tracking-[0.3em] text-cyan-300/60 animate-pulse">
            AURA SYNC ACQUIRED
          </div>
        )}
      </div>
    </div>
  );
}
