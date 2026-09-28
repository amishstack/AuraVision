"use client";

import { useEffect, useMemo, useRef } from "react";
import { MESH, sparseScaffold } from "@/lib/geometry/mesh";

/**
 * Visual Signature hero — the merged multi-view canonical point cloud
 * rendered on a slow turntable. Orthographic projection of the de-rotated
 * landmark geometry; points + sparse scaffold + silhouette.
 */

const ACCENT = "140, 210, 240";
const WHITE = "225, 232, 240";

export default function SignatureMesh({
  points,
  size = 260,
}: {
  points: Float32Array | null;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scaffold = useMemo(() => sparseScaffold(8), []);
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

      // gentle oscillating turntable ±38°
      const t = (performance.now() - t0) / 1000;
      const yaw = Math.sin(t * 0.55) * 0.66;
      const pitch = Math.sin(t * 0.22) * 0.10;
      const cyw = Math.cos(yaw), syw = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);

      const n = pts.length / 3;
      const sx = new Float32Array(n);
      const sy = new Float32Array(n);
      const sz = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
        // yaw about Y
        const x1 = cyw * x + syw * z;
        const z1 = -syw * x + cyw * z;
        // pitch about X
        const y2 = cp * y - sp * z1;
        const z2 = sp * y + cp * z1;
        sx[i] = cx + x1 * R;
        sy[i] = cy + y2 * R;
        sz[i] = z2;
      }

      // sparse scaffold
      ctx.lineJoin = "round";
      ctx.strokeStyle = `rgba(${ACCENT}, 0.14)`;
      ctx.lineWidth = dpr * 0.7;
      ctx.beginPath();
      for (const e of scaffold) {
        if (e.start >= n || e.end >= n) continue;
        ctx.moveTo(sx[e.start], sy[e.start]);
        ctx.lineTo(sx[e.end], sy[e.end]);
      }
      ctx.stroke();

      // silhouette + features
      const feat = [MESH.faceOval, MESH.leftEye, MESH.rightEye, MESH.lips];
      ctx.strokeStyle = `rgba(${WHITE}, 0.5)`;
      ctx.lineWidth = dpr;
      ctx.beginPath();
      for (const set of feat) {
        for (const e of set) {
          if (e.start >= n || e.end >= n) continue;
          ctx.moveTo(sx[e.start], sy[e.start]);
          ctx.lineTo(sx[e.end], sy[e.end]);
        }
      }
      ctx.stroke();

      // nodes — near points brighter (depth cue)
      for (let i = 0; i < n; i += 1) {
        const rel = Math.max(0, Math.min(1, sz[i] * 0.5 + 0.5));
        const a = 0.15 + 0.45 * rel;
        ctx.fillStyle = `rgba(${ACCENT}, ${a})`;
        ctx.fillRect(sx[i] - dpr * 0.75, sy[i] - dpr * 0.75, dpr * 1.5, dpr * 1.5);
      }
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [scaffold, size]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}
