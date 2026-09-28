"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { coverFit, throughCover } from "@/lib/vision/imageTransform";
import type { TrackingFrame } from "@/types/vision";

/**
 * Expression Lab — displacement-vector layer. Draws baseline→current
 * vectors on landmarks whose geometric position has moved meaningfully,
 * plus a faint baseline ghost. Movement-driven regions brighten via the
 * live expression vector. All geometry from real landmarks; no
 * emotion classification.
 */

const ACCENT = "140, 210, 240";
const WHITE = "225, 232, 240";

const STRIDE = 9;          // ~53 probe points across the face
const MIN_DISP = 0.006;    // normalized — below this no vector is drawn

interface Props {
  frame: MutableRefObject<TrackingFrame>;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  snap: TrackingFrame;
  debug: boolean;
  fun?: boolean;
  onExit?: () => void;
}

export default function ExpressionLabOverlay({
  frame,
  videoRef,
  snap,
  debug,
  fun = false,
  onExit,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const funRef = useRef(fun);
  useEffect(() => {
    funRef.current = fun;
  }, [fun]);
  // temporal trail of recent current-landmark fields
  const trail = useRef<Float32Array[]>([]);
  const pulseAt = useRef(0);
  const prevPhase = useRef("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const render = () => {
      raf = requestAnimationFrame(render);
      const f = frame.current;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || f.state !== "lab") {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        trail.current.length = 0;
        prevPhase.current = "";
        return;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = video.getBoundingClientRect();
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);

      const cur = f.landmarks;
      const baseline = f.lab?.baseline ?? null;
      if (!cur) return;

      const fit = coverFit(
        video.videoWidth || w,
        video.videoHeight || h,
        w,
        h,
      );
      const mirror = f.mirrored;
      const px = (p: { x: number; y: number }) => throughCover(p, fit, mirror);
      const lineCol = funRef.current ? ACCENT : WHITE;

      // capture pulse — brief expanding flash when a challenge lands
      const phase = f.lab?.phase ?? "";
      if (phase === "capture" && prevPhase.current === "prompt") {
        pulseAt.current = performance.now();
      }
      prevPhase.current = phase;
      const pulseAge = performance.now() - pulseAt.current;
      if (funRef.current && pulseAge < 600 && f.boundingBox) {
        const bb = f.boundingBox;
        const [ccx, ccy] = px({ x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 });
        const r = bb.w * fit.dispW * (0.3 + (pulseAge / 600) * 0.5);
        ctx.strokeStyle = `rgba(${ACCENT}, ${(1 - pulseAge / 600) * 0.4})`;
        ctx.lineWidth = dpr;
        ctx.beginPath();
        ctx.arc(ccx, ccy, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (!baseline) return; // baseline still acquiring — nothing to diff

      // --- baseline ghost -------------------------------------------------
      ctx.fillStyle = `rgba(${WHITE}, 0.14)`;
      for (let i = 0; i < baseline.length; i += STRIDE * 2) {
        const [gx, gy] = px(baseline[i]);
        ctx.beginPath();
        ctx.arc(gx, gy, 1.1 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- temporal trail (short decaying ghost of recent positions) ------
      trail.current.push(Float32Array.from(cur.flatMap((p) => [p.x, p.y])));
      if (trail.current.length > 4) trail.current.shift();
      if (funRef.current) {
        for (let ti = 0; ti < trail.current.length - 1; ti++) {
          const tp = trail.current[ti];
          const ta = 0.05 + (ti / trail.current.length) * 0.08;
          ctx.fillStyle = `rgba(${ACCENT}, ${ta})`;
          for (let i = 0; i < tp.length; i += STRIDE * 2) {
            const [tx, ty] = px({ x: tp[i], y: tp[i + 1] });
            ctx.beginPath();
            ctx.arc(tx, ty, 0.9 * dpr, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // --- displacement vectors -------------------------------------------
      ctx.lineWidth = 1.1 * dpr;
      for (let i = 0; i < cur.length; i += STRIDE) {
        const a = baseline[i];
        const b = cur[i];
        if (!a || !b) continue;
        const disp = Math.hypot(b.x - a.x, b.y - a.y);
        if (disp < MIN_DISP) continue;
        const strength = Math.min(1, disp / 0.06);
        const [ax, ay] = px(a);
        const [bx, by] = px(b);
        ctx.strokeStyle = `rgba(${lineCol}, ${0.25 + strength * 0.5})`;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        // vector tip
        const ang = Math.atan2(by - ay, bx - ax);
        const tip = 3 * dpr;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(
          bx - tip * Math.cos(ang - 0.5),
          by - tip * Math.sin(ang - 0.5),
        );
        ctx.moveTo(bx, by);
        ctx.lineTo(
          bx - tip * Math.cos(ang + 0.5),
          by - tip * Math.sin(ang + 0.5),
        );
        ctx.stroke();
        ctx.fillStyle = `rgba(${lineCol}, ${0.4 + strength * 0.5})`;
        ctx.beginPath();
        ctx.arc(bx, by, 1.4 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [frame, videoRef]);

  const lab = snap.lab;
  return (
    <>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      {snap.state === "lab" && lab && (
        <>
          {/* primary instruction — top safe zone */}
          <div className="absolute left-1/2 top-3 w-max max-w-[92vw] -translate-x-1/2 rounded bg-black/40 px-4 py-2 text-center font-mono backdrop-blur-[2px] sm:top-4">
            <div className="text-[8px] font-medium tracking-[0.25em] text-neutral-500">
              {lab.phase === "baseline"
                ? "NEUTRAL BASELINE"
                : `CHALLENGE ${lab.challengeIndex + 1}/${lab.challengeTotal}`}
            </div>
            <div
              className={`mt-1 text-[13px] font-medium tracking-[0.2em] ${
                lab.phase === "capture" ? "text-cyan-200" : "text-neutral-100"
              }`}
            >
              {lab.instruction}
            </div>
            {lab.holdProgress > 0 && lab.holdProgress < 1 && (
              <div className="mx-auto mt-1.5 h-px w-24 bg-neutral-800">
                <div
                  className="h-px bg-cyan-300 transition-[width] duration-100"
                  style={{ width: `${lab.holdProgress * 100}%` }}
                />
              </div>
            )}
          </div>

          {/* live expression vector — lower safe zone */}
          {lab.vector && (
            <div className="absolute bottom-12 left-1/2 w-[min(78vw,300px)] -translate-x-1/2 sm:bottom-14">
              <div className="rounded bg-black/40 px-3 py-2 font-mono text-[8px] font-medium tracking-[0.14em] backdrop-blur-[2px]">
                <div className="mb-1 text-neutral-500">EXPRESSION VECTOR</div>
                {(
                  [
                    ["BROW", lab.vector.brow],
                    ["EYES", lab.vector.eyes],
                    ["MOUTH", lab.vector.mouth],
                    ["CHEEKS", lab.vector.cheeks],
                    ["JAW", lab.vector.jaw],
                  ] as const
                ).map(([name, v]) => (
                  <div key={name} className="flex items-center gap-2">
                    <span className="w-12 text-neutral-400">{name}</span>
                    <div className="h-px flex-1 bg-neutral-800">
                      <div
                        className="h-px bg-cyan-300/80 transition-[width] duration-150"
                        style={{ width: `${Math.round(v * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {onExit && (
            <button
              onClick={onExit}
              className="absolute bottom-12 right-3 rounded border border-white/15 bg-black/50 px-3 py-2 font-mono text-[8px] font-medium tracking-[0.2em] text-neutral-400 backdrop-blur-[2px] transition-colors hover:text-neutral-200 sm:bottom-14 sm:right-4"
            >
              EXIT
            </button>
          )}

          {debug && (
            <div className="absolute right-2 top-2 rounded bg-black/50 px-2 py-1 font-mono text-[8px] text-neutral-400">
              <div>EXPRESSION DEBUG</div>
              <div>VECTOR {((lab.vector?.overall ?? 0) * 100).toFixed(0)}%</div>
              <div>HOLD {Math.round(lab.holdProgress * 100)}%</div>
            </div>
          )}
        </>
      )}
    </>
  );
}
