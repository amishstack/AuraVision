"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MESH, sparseScaffold } from "@/lib/geometry/mesh";
import type { BestFrameResult } from "@/types/vision";

/**
 * Optimal Frame — the best captured candidate shown locally with a
 * geometry-overlay toggle and a qualitative quality breakdown.
 */

const ACCENT = "140, 210, 240";
const WHITE = "225, 232, 240";

function label(v: number): string {
  if (v >= 85) return "EXCELLENT";
  if (v >= 65) return "GOOD";
  if (v >= 45) return "MODERATE";
  return "LOW";
}

export default function OptimalFrame({
  best,
  mirrored,
}: {
  best: BestFrameResult;
  mirrored: boolean;
}) {
  const [showGeo, setShowGeo] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geoRef = useRef(showGeo);
  const scaffold = useMemo(() => sparseScaffold(5), []);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgReady, setImgReady] = useState(false);

  useEffect(() => {
    geoRef.current = showGeo;
  }, [showGeo]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgReady(true);
    };
    img.src = best.image;
  }, [best.image]);

  useEffect(() => {
    if (!imgReady) return;
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const render = () => {
      raf = requestAnimationFrame(render);
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.round(rect.width * dpr);
      const H = Math.round(rect.height * dpr);
      if (canvas.width !== W) {
        canvas.width = W;
        canvas.height = H;
      }
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);

      if (!geoRef.current) return;

      // map captured landmark coords through the same crop
      const c = best.crop;
      const px = (p: { x: number; y: number }) => [
        ((mirrored ? 1 - p.x : p.x) - c.x) / c.w * W,
        (p.y - c.y) / c.h * H,
      ] as const;
      const lm = best.landmarks;
      ctx.lineJoin = "round";
      const edges = (
        set: readonly { start: number; end: number }[],
        col: string, a: number, wdt: number,
      ) => {
        ctx.strokeStyle = `rgba(${col}, ${a})`;
        ctx.lineWidth = wdt * dpr;
        ctx.beginPath();
        for (const e of set) {
          const A = lm[e.start], B = lm[e.end];
          if (!A || !B) continue;
          const [ax, ay] = px(A);
          const [bx, by] = px(B);
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
        }
        ctx.stroke();
      };
      edges(scaffold, ACCENT, 0.18, 0.6);
      edges(MESH.faceOval, WHITE, 0.6, 1.0);
      edges(MESH.leftEye, WHITE, 0.5, 0.9);
      edges(MESH.rightEye, WHITE, 0.5, 0.9);
      edges(MESH.lips, WHITE, 0.5, 0.9);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [imgReady, best, mirrored, scaffold]);

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[9px] tracking-[0.25em] text-neutral-600">
          OPTIMAL FRAME
        </span>
        <button
          onClick={() => setShowGeo((v) => !v)}
          className="font-mono text-[9px] tracking-[0.2em] text-neutral-500 transition-colors hover:text-neutral-300"
        >
          GEOMETRY {showGeo ? "ON" : "OFF"}
        </button>
      </div>

      <canvas
        ref={canvasRef}
        className="w-full rounded-sm border border-neutral-800"
        style={{ aspectRatio: "4 / 4.4" }}
      />

      <div className="mt-3 space-y-1 text-[10px]">
        {(
          [
            ["LIGHTING", best.parts.lighting],
            ["FRAMING", best.parts.framing],
            ["ANGLE", best.parts.angle],
            ["VISIBILITY", best.parts.visibility],
            ["GAZE", best.parts.gaze],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <span className="text-neutral-600">{k}</span>
            <span className="text-neutral-300">{label(v)}</span>
          </div>
        ))}
        <div className="flex justify-between pt-1">
          <span className="text-neutral-600">CAPTURED POSE</span>
          <span className="text-neutral-300">{best.angleLabel}</span>
        </div>
      </div>
    </div>
  );
}
