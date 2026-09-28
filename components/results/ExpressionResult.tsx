"use client";

import { useEffect, useRef, useState } from "react";
import { MESH } from "@/lib/geometry/mesh";
import type {
  ExpressionLabResult,
  Landmark,
} from "@/types/vision";

/**
 * Expression Lab result — the session's geometric motion profile.
 * Values derive from real per-region landmark displacement vs. the
 * frozen neutral baseline. No emotion or personality claims.
 */

const ACCENT = "140, 210, 240";
const WHITE = "225, 232, 240";

function drawGhost(
  ctx: CanvasRenderingContext2D,
  lm: Landmark[] | null,
  w: number,
  h: number,
  alpha: number,
  col: string,
) {
  if (!lm || lm.length < 400 || alpha <= 0.01) return;
  // fit landmark set to canvas with margin
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const bw = Math.max(1e-4, maxX - minX);
  const bh = Math.max(1e-4, maxY - minY);
  const s = Math.min(w * 0.8 / bw, h * 0.8 / bh);
  const ox = w / 2 - ((minX + maxX) / 2) * s;
  const oy = h / 2 - ((minY + maxY) / 2) * s;
  const P = (i: number) => ({ x: lm[i].x * s + ox, y: lm[i].y * s + oy });

  ctx.strokeStyle = `rgba(${col}, ${alpha * 0.7})`;
  ctx.lineWidth = 1;
  for (const set of [
    MESH.faceOval,
    MESH.lips,
    MESH.leftEye,
    MESH.rightEye,
    MESH.leftBrow,
    MESH.rightBrow,
  ]) {
    ctx.beginPath();
    for (const e of set) {
      const a = P(e.start);
      const b = P(e.end);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = `rgba(${col}, ${alpha * 0.4})`;
  for (let i = 0; i < lm.length; i += 8) {
    const p = P(i);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

export default function ExpressionResult({
  result,
  fun,
  onLive,
  onRestart,
}: {
  result: ExpressionLabResult;
  fun: boolean;
  onLive: () => void;
  onRestart: () => void;
}) {
  const [blend, setBlend] = useState(1); // 0 = baseline, 1 = current
  const [barsOn, setBarsOn] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setBarsOn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = 300 * dpr;
    canvas.height = 220 * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, 300, 220);
    drawGhost(ctx, result.baseline, 300, 220, 1 - blend, WHITE);
    drawGhost(ctx, result.lastLandmarks, 300, 220, blend, ACCENT);
  }, [result, blend]);

  const a = result.aggregate;
  const rows: [string, number][] = [
    ["BROW", a.brow],
    ["EYES", a.eyes],
    ["NOSE", a.nose],
    ["MOUTH", a.mouth],
    ["CHEEKS", a.cheeks],
    ["JAW", a.jaw],
  ];

  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-[#0b0d0e] animate-[fadeIn_0.6s_ease-out]">
      <div className="mx-auto flex min-h-full w-full max-w-sm flex-col items-center px-6 py-6 font-mono tracking-[0.15em]">
        <div className="text-[9px] tracking-[0.3em] text-neutral-500">
          EXPRESSION LAB
        </div>
        <h1 className="mt-2 text-xl font-medium tracking-[0.2em] text-neutral-100">
          EXPRESSION CAPTURED
        </h1>
        <div className="mt-1 text-[9px] tracking-[0.25em] text-cyan-200/80">
          DYNAMIC PROFILE
        </div>

        {/* before / after ghost compare */}
        <div className="mt-5 w-full max-w-[300px]">
          <canvas
            ref={canvasRef}
            className="w-full rounded border border-white/10"
            style={{ height: 220 }}
          />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={blend}
            onChange={(e) => setBlend(parseFloat(e.target.value))}
            aria-label="baseline to current blend"
            className="mt-2 w-full accent-cyan-300"
          />
          <div className="flex justify-between text-[8px] tracking-[0.2em] text-neutral-500">
            <span>BASELINE</span>
            <span>CURRENT</span>
          </div>
        </div>

        {/* expression vector */}
        <div className="mt-5 w-full max-w-[300px] rounded border border-white/10 px-4 py-3">
          <div className="mb-2 text-[8px] tracking-[0.25em] text-neutral-500">
            FACIAL MOTION PROFILE
          </div>
          {rows.map(([name, v]) => (
            <div key={name} className="flex items-center gap-2 py-0.5">
              <span className="w-14 text-[9px] text-neutral-400">{name}</span>
              <div className="h-1 flex-1 bg-neutral-800">
                <div
                  className="h-1 bg-cyan-300/80 transition-[width] duration-700 ease-out"
                  style={{ width: `${barsOn ? Math.round(v * 100) : 0}%` }}
                />
              </div>
              <span className="w-8 text-right text-[9px] text-neutral-400">
                {Math.round(v * 100)}%
              </span>
            </div>
          ))}
          <div className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2">
            <span className="w-14 text-[9px] text-neutral-300">DYNAMIC</span>
            <div className="h-1 flex-1 bg-neutral-800">
              <div
                className="h-1 bg-cyan-300 transition-[width] duration-700 ease-out"
                style={{ width: `${barsOn ? Math.round(a.overall * 100) : 0}%` }}
              />
            </div>
            <span className="w-8 text-right text-[9px] text-neutral-200">
              {Math.round(a.overall * 100)}%
            </span>
          </div>
          <div className="mt-2 text-[7px] tracking-[0.2em] text-neutral-600">
            {result.challenges.length} CHALLENGES · LOCAL SESSION ANALYSIS
          </div>
          <div className="mt-0.5 text-[7px] tracking-[0.2em] text-neutral-600">
            GEOMETRIC MOTION · MEASURED FROM BASELINE DISPLACEMENT
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onRestart}
            className="rounded border border-white/20 px-4 py-2 text-[9px] tracking-[0.25em] text-neutral-300 transition hover:border-cyan-300/50 hover:text-cyan-200"
          >
            REPLAY LAB
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
            MOTION LOGGED
          </div>
        )}
      </div>
    </div>
  );
}
