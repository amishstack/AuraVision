"use client";

import { useEffect, useRef } from "react";
import { projectTurntable, drawSignatureMesh } from "@/lib/visualization/meshRender";

/**
 * Visual Signature hero — the merged multi-view canonical point cloud
 * rendered on a slow turntable (±38° yaw, gentle pitch drift).
 */
export default function SignatureMesh({
  points,
  size = 260,
  fun = false,
}: {
  points: Float32Array | null;
  size?: number;
  fun?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ptsRef = useRef(points);
  useEffect(() => {
    ptsRef.current = points;
  }, [points]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const R = canvas.width * 0.45;

    let raf = 0;
    const t0 = performance.now();
    const render = () => {
      raf = requestAnimationFrame(render);
      const pts = ptsRef.current;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!pts || pts.length === 0) return;
      const t = (performance.now() - t0) / 1000;
      const proj = projectTurntable(
        pts,
        fun
          ? Math.sin(t * 0.85) * 0.78 // livelier ±~45° orbit in FUN
          : Math.sin(t * 0.55) * 0.66,
        fun ? Math.sin(t * 0.31) * 0.14 : Math.sin(t * 0.22) * 0.10,
        cx,
        cy,
        R,
      );
      drawSignatureMesh(ctx, proj, dpr);
      // FUN pulse — brief glow ring on each orbit beat
      if (fun) {
        const beat = (Math.sin(t * 1.7) + 1) / 2;
        ctx.strokeStyle = `rgba(140,210,240,${0.05 + beat * 0.08})`;
        ctx.lineWidth = dpr;
        ctx.beginPath();
        ctx.arc(cx, cy, R * (0.72 + beat * 0.06), 0, Math.PI * 2);
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [size, fun]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}
