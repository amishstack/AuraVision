"use client";

import { useEffect, useRef, useState } from "react";
import { MESH } from "@/lib/geometry/mesh";
import { activityLabel } from "@/lib/lab/motionSignature";
import type { Landmark, MotionSignatureData } from "@/types/vision";

/**
 * Motion Signature — the V7.4 artifact. A radial fingerprint whose six
 * arcs are driven deterministically by recorded regional activity, over
 * a faint baseline silhouette and the session's temporal waveform.
 * Visual fingerprint of motion — not a psychological assessment.
 */

const ACCENT = "140, 210, 240";
const WHITE = "225, 232, 240";

const ARCS = [
  ["BROW", "brow", 0],
  ["EYES", "eyes", 1],
  ["NOSE", "nose", 2],
  ["MOUTH", "mouth", 3],
  ["CHEEKS", "cheeks", 4],
  ["JAW", "jaw", 5],
] as const;

function drawSilhouette(
  ctx: CanvasRenderingContext2D,
  lm: Landmark[],
  cx: number,
  cy: number,
  r: number,
  alpha: number,
) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const s = Math.min((r * 1.5) / (maxX - minX || 1e-4), (r * 1.8) / (maxY - minY || 1e-4));
  const ox = cx - ((minX + maxX) / 2) * s;
  const oy = cy - ((minY + maxY) / 2) * s;
  ctx.strokeStyle = `rgba(${WHITE}, ${alpha})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const e of MESH.faceOval) {
    const a = lm[e.start];
    const b = lm[e.end];
    if (!a || !b) continue;
    ctx.moveTo(a.x * s + ox, a.y * s + oy);
    ctx.lineTo(b.x * s + ox, b.y * s + oy);
  }
  ctx.stroke();
  for (const set of [MESH.leftEye, MESH.rightEye, MESH.lips]) {
    ctx.strokeStyle = `rgba(${WHITE}, ${alpha * 0.7})`;
    ctx.beginPath();
    for (const e of set) {
      const a = lm[e.start];
      const b = lm[e.end];
      if (!a || !b) continue;
      ctx.moveTo(a.x * s + ox, a.y * s + oy);
      ctx.lineTo(b.x * s + ox, b.y * s + oy);
    }
    ctx.stroke();
  }
}

/** Render the fingerprint onto any 2D context — shared by hero + card. */
export function drawFingerprint(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  sig: MotionSignatureData,
  progress: number, // 0..1 build animation
  t: number,
  fun: boolean,
) {
  if (sig.baseline && sig.baseline.length > 400) {
    drawSilhouette(ctx, sig.baseline, cx, cy, R * 0.62, 0.16 * progress);
  }

  // six regional arcs — length ∝ recorded mean activity
  ARCS.forEach(([label, key, i]) => {
    const act = sig.regionMean[key];
    const pk = sig.regionPeak[key];
    const r = R * (0.5 + i * 0.09);
    const arcLen = 0.4 + act * 2.2; // radians of arc
    const rot = t * (fun ? 0.25 : 0.08) * (i % 2 ? 1 : -1) + i * 0.8;
    const drawFrac = Math.max(0, Math.min(1, progress * ARCS.length - i));
    if (drawFrac <= 0) return;
    ctx.strokeStyle = `rgba(${ACCENT}, ${(0.25 + pk * 0.6) * drawFrac})`;
    ctx.lineWidth = 1 + pk * 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, rot, rot + arcLen * drawFrac);
    ctx.stroke();
    // activity dots along the arc
    const dots = Math.round(act * 10);
    for (let k = 0; k < dots * drawFrac; k++) {
      const a = rot + (arcLen * k) / Math.max(1, dots - 1);
      ctx.fillStyle = `rgba(${ACCENT}, ${0.4 * drawFrac})`;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1, 0, Math.PI * 2);
      ctx.fill();
    }
    void label;
  });

  // temporal waveform ring — decimated series as radial spokes
  const n = sig.series.length;
  ctx.strokeStyle = `rgba(${WHITE}, 0.35)`;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const rr = R * (1.02 + sig.series[i] * 0.12 * progress);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
}

export default function MotionSignature({
  signature,
  fun,
  onReplay,
  onTimeline,
  onLab,
  onLive,
}: {
  signature: MotionSignatureData;
  fun: boolean;
  onReplay: () => void;
  onTimeline: () => void;
  onLab: () => void;
  onLive: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sharing, setSharing] = useState(false);
  const revealAt = useRef(0);

  useEffect(() => {
    revealAt.current = performance.now();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const render = () => {
      raf = requestAnimationFrame(render);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = 300, H = 300;
      if (canvas.width !== W * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const elapsed = (performance.now() - revealAt.current) / 1000;
      const progress = Math.min(1, elapsed / 2.2);
      const eased = progress * progress * (3 - 2 * progress);
      drawFingerprint(
        ctx,
        W / 2,
        H / 2,
        W * 0.4,
        signature,
        eased,
        performance.now() / 1000,
        fun,
      );
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [signature, fun]);

  const share = async () => {
    setSharing(true);
    try {
      const c = document.createElement("canvas");
      const dpr = 2;
      c.width = 600 * dpr;
      c.height = 760 * dpr;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#0b0d0e";
      ctx.fillRect(0, 0, 600, 760);
      ctx.font = "10px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = `rgba(${WHITE}, 0.5)`;
      ctx.fillText("AURAVISION", 300, 46);
      ctx.font = "16px ui-monospace, monospace";
      ctx.fillStyle = `rgba(${WHITE}, 0.92)`;
      ctx.fillText("MOTION SIGNATURE", 300, 74);
      ctx.font = "9px ui-monospace, monospace";
      ctx.fillStyle = `rgba(${ACCENT}, 0.8)`;
      ctx.fillText("TEMPORAL FACIAL RESPONSE", 300, 94);
      drawFingerprint(ctx, 300, 340, 170, signature, 1, 1.5, fun);
      ctx.fillStyle = `rgba(${WHITE}, 0.55)`;
      ctx.fillText(`PEAK REGION  ${signature.peakRegion}`, 300, 620);
      ctx.fillText(
        `ACTIVE WINDOW  ${(signature.activeMs / 1000).toFixed(1)}s`,
        300,
        642,
      );
      ctx.fillText(`EVENTS  ${signature.eventCount}`, 300, 664);
      ctx.fillStyle = `rgba(${WHITE}, 0.35)`;
      ctx.fillText("LOCAL ANALYSIS · NO SERVER UPLOAD", 300, 720);
      const blob = await new Promise<Blob | null>((r) =>
        c.toBlob(r, "image/png"),
      );
      const file = blob
        ? new File([blob], "auravision-motion.png", { type: "image/png" })
        : null;
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "AuraVision",
          text: "Motion Signature — temporal facial response",
        });
      } else if (navigator.share) {
        await navigator.share({
          title: "AuraVision",
          text: `MOTION SIGNATURE — peak ${signature.peakRegion}, ${signature.eventCount} events`,
        });
      }
    } catch {
      // cancelled/unsupported
    } finally {
      setSharing(false);
    }
  };

  const rows: [string, number][] = [
    ["BROW", signature.regionMean.brow],
    ["EYES", signature.regionMean.eyes],
    ["NOSE", signature.regionMean.nose],
    ["MOUTH", signature.regionMean.mouth],
    ["CHEEKS", signature.regionMean.cheeks],
    ["JAW", signature.regionMean.jaw],
  ];

  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-[#0b0d0e] animate-[fadeIn_0.6s_ease-out]">
      <div className="mx-auto flex min-h-full w-full max-w-sm flex-col items-center px-6 py-6 font-mono tracking-[0.15em]">
        <div className="text-[9px] tracking-[0.3em] text-neutral-500">
          AURAVISION
        </div>
        <h1 className="mt-2 text-xl font-medium tracking-[0.2em] text-neutral-100">
          MOTION SIGNATURE
        </h1>
        <div className="mt-1 text-[9px] tracking-[0.25em] text-cyan-200/80">
          TEMPORAL FACIAL RESPONSE
        </div>

        <canvas
          ref={canvasRef}
          className="mt-5 w-full max-w-[300px] rounded border border-white/10"
          style={{ height: 300 }}
        />

        <div className="mt-5 w-full max-w-[300px] rounded border border-white/10 px-4 py-3">
          <div className="mb-2 text-[8px] tracking-[0.25em] text-neutral-500">
            MOTION PROFILE
          </div>
          {rows.map(([name, v]) => (
            <div key={name} className="flex items-center justify-between py-0.5">
              <span className="text-[9px] text-neutral-400">{name}</span>
              <span className="text-[9px] text-neutral-300">
                {activityLabel(v)}
              </span>
            </div>
          ))}
          <div className="mt-2 border-t border-white/10 pt-2">
            <div className="flex justify-between">
              <span className="text-[9px] text-neutral-400">TEMPORAL RHYTHM</span>
              <span className="text-[9px] text-cyan-200/90">
                {signature.rhythm}
              </span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-[9px] text-neutral-400">ACTIVE WINDOW</span>
              <span className="text-[9px] text-neutral-300">
                {(signature.activeMs / 1000).toFixed(1)}s /{" "}
                {(signature.durationMs / 1000).toFixed(1)}s
              </span>
            </div>
          </div>
          <div className="mt-2 text-[7px] tracking-[0.2em] text-neutral-600">
            {signature.eventCount} EVENTS · LOCAL SESSION ANALYSIS
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              revealAt.current = performance.now();
              onReplay();
            }}
            className="rounded border border-white/20 px-4 py-2 text-[9px] tracking-[0.25em] text-neutral-300 transition hover:border-cyan-300/50 hover:text-cyan-200"
          >
            REPLAY MOTION
          </button>
          <button
            onClick={share}
            disabled={sharing}
            className="rounded border border-cyan-300/40 bg-cyan-300/10 px-4 py-2 text-[9px] tracking-[0.25em] text-cyan-200 transition hover:bg-cyan-300/20"
          >
            {sharing ? "…" : "CREATE MOTION CARD"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button
            onClick={onLab}
            className="rounded border border-white/20 px-4 py-2 text-[9px] tracking-[0.25em] text-neutral-300 transition hover:border-cyan-300/50 hover:text-cyan-200"
          >
            LIVE LAB
          </button>
          <button
            onClick={onTimeline}
            className="rounded border border-white/20 px-4 py-2 text-[9px] tracking-[0.25em] text-neutral-300 transition hover:border-cyan-300/50 hover:text-cyan-200"
          >
            VIEW TIMELINE
          </button>
          <button
            onClick={onLive}
            className="rounded border border-white/15 px-4 py-2 text-[9px] tracking-[0.25em] text-neutral-400 transition hover:text-neutral-200"
          >
            EXIT
          </button>
        </div>
      </div>
    </div>
  );
}
