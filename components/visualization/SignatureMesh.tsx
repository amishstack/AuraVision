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
}: {
  points: Float32Array | null;
  size?: number;
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
    const R = canvas.width * 0.42;

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
        Math.sin(t * 0.55) * 0.66,   // ±~38°
        Math.sin(t * 0.22) * 0.10,
        cx,
        cy,
        R,
      );
      drawSignatureMesh(ctx, proj, dpr);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}
