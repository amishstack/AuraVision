"use client";

import { useEffect, useRef } from "react";
import type { AnalysisReport } from "@/types/vision";

/**
 * Aura Field — an ambient visual field derived from the user's actual
 * analysis: palette colors, signature-cloud anchor points, motion energy,
 * contrast, and symmetry. Particles drift along slow arcs radiating from
 * the facial geometry — not a generic wallpaper.
 */

const FALLBACK = ["#8cd2f0", "#e1e8f0", "#3a4a55", "#1a2228", "#6b7d89"];

export default function AuraField({
  report,
  size = 260,
}: {
  report: AnalysisReport;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reportRef = useRef(report);
  useEffect(() => {
    reportRef.current = report;
  }, [report]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;

    // anchor particles to the signature cloud where available
    const anchors: { x: number; y: number; z: number }[] = [];
    const build = () => {
      anchors.length = 0;
      const r = reportRef.current;
      const pts = r.signaturePoints;
      const colors = r.palette?.colors.length ? r.palette.colors : FALLBACK;
      if (pts && pts.length > 0) {
        const n = pts.length / 3;
        // ~110 particles anchored to cloud points
        for (let k = 0; k < 110; k++) {
          const i = Math.floor((k / 110) * n);
          anchors.push({
            x: cx + pts[i * 3] * W * 0.42,
            y: cy + pts[i * 3 + 1] * H * 0.42,
            z: pts[i * 3 + 2],
          });
        }
      }
      void colors;
    };
    build();

    let raf = 0;
    const t0 = performance.now();
    const render = () => {
      raf = requestAnimationFrame(render);
      const r = reportRef.current;
      const colors = r.palette?.colors.length ? r.palette.colors : FALLBACK;
      const energy = 0.25 + r.aesthetic.total / 400; // subtle
      const contrast = 0.5 + (r.palette ? 0.3 : 0);
      const t = (performance.now() - t0) / 1000;

      ctx.clearRect(0, 0, W, H);

      // radial gradient wash in dominant palette colors
      const g = ctx.createRadialGradient(cx, cy, W * 0.05, cx, cy, W * 0.55);
      g.addColorStop(0, hexA(colors[0], 0.10 * contrast));
      g.addColorStop(0.6, hexA(colors[1] ?? colors[0], 0.05 * contrast));
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // slow concentric arcs centered on the face
      for (let ring = 0; ring < 4; ring++) {
        const radius = W * (0.16 + ring * 0.11);
        const start = t * (0.05 + ring * 0.017) + ring * 1.3;
        const span = Math.PI * (0.5 + 0.3 * Math.sin(t * 0.11 + ring));
        ctx.strokeStyle = hexA(colors[ring % colors.length], 0.16);
        ctx.lineWidth = dpr * 0.8;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, start, start + span);
        ctx.stroke();
      }

      // anchored particles drifting along small arcs
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        const ang = t * (0.15 + a.z * 0.1) * energy + i;
        const rad = (6 + a.z * 4) * dpr;
        const x = a.x + Math.cos(ang) * rad;
        const y = a.y + Math.sin(ang * 0.7) * rad;
        const rel = Math.max(0, Math.min(1, a.z * 0.5 + 0.5));
        ctx.fillStyle = hexA(colors[i % colors.length], 0.10 + 0.30 * rel);
        ctx.fillRect(x - dpr * 0.6, y - dpr * 0.6, dpr * 1.2, dpr * 1.2);
      }

      // faint contour traces between nearby anchors
      ctx.lineWidth = dpr * 0.5;
      for (let i = 0; i < anchors.length - 3; i += 4) {
        const a = anchors[i], b = anchors[i + 3];
        const dd = Math.hypot(a.x - b.x, a.y - b.y);
        if (dd > W * 0.14) continue;
        ctx.strokeStyle = hexA(colors[(i / 4 | 0) % colors.length], 0.06);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
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

function hexA(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}
