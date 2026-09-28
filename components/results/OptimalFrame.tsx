"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MESH, sparseScaffold } from "@/lib/geometry/mesh";
import { regionMapper } from "@/lib/vision/imageTransform";
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

// semantic landmarks for the DEBUG registration diagnostic
const REG_MARKS = [
  [468, "L.EYE"],
  [473, "R.EYE"],
  [4, "NOSE"],
  [13, "MOUTH"],
  [152, "CHIN"],
  [234, "L.JAW"],
  [454, "R.JAW"],
] as const;

export default function OptimalFrame({
  best,
  mirrored,
  debug = false,
}: {
  best: BestFrameResult;
  mirrored: boolean;
  debug?: boolean;
}) {
  const [showGeo, setShowGeo] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geoRef = useRef(showGeo);
  const scaffold = useMemo(() => sparseScaffold(5), []);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const [imgAspect, setImgAspect] = useState(4 / 4.4);
  const debugRef = useRef(debug);

  useEffect(() => {
    geoRef.current = showGeo;
  }, [showGeo]);

  useEffect(() => {
    debugRef.current = debug;
  }, [debug]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgAspect(img.width / img.height);
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

      if (!geoRef.current && !debugRef.current) return;

      // canonical registration — the captured image was flipped within
      // its crop rect, so the same rect-space mirror applies here
      const px = regionMapper(best.crop, W, H, mirrored);
      const lm = best.landmarks;
      ctx.lineJoin = "round";
      if (geoRef.current) {
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
      }

      // DEBUG — landmark registration diagnostic: semantic marks must
      // sit exactly on the physical features of the captured frame
      if (debugRef.current) {
        ctx.font = `${7 * dpr}px monospace`;
        ctx.textAlign = "left";
        for (const [idx, name] of REG_MARKS) {
          const p = lm[idx];
          if (!p) continue;
          const [x, y] = px(p);
          ctx.strokeStyle = "rgba(255, 120, 80, 0.9)";
          ctx.lineWidth = dpr;
          ctx.beginPath();
          ctx.moveTo(x - 3 * dpr, y);
          ctx.lineTo(x + 3 * dpr, y);
          ctx.moveTo(x, y - 3 * dpr);
          ctx.lineTo(x, y + 3 * dpr);
          ctx.stroke();
          ctx.fillStyle = "rgba(255, 120, 80, 0.9)";
          ctx.fillText(name, x + 4 * dpr, y - 3 * dpr);
        }
        ctx.fillStyle = "rgba(255, 120, 80, 0.9)";
        ctx.fillText("LANDMARK REGISTRATION", 6 * dpr, 10 * dpr);
      }
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
        style={{ aspectRatio: `${imgAspect}` }}
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
