"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { coverFit, throughCover } from "@/lib/vision/imageTransform";
import { REGION_IDX } from "@/lib/expression/vector";
import type { TrackingFrame } from "@/types/vision";

/**
 * Free Expression Lab — live motion field. Baseline ghost, bounded
 * temporal trails, and per-region activity pulses driven by the V7.1
 * corrected displacement vector. Still = quiet; motion = response.
 * Decorative extras are gated behind FUN; measurements never change.
 */

const ACCENT = "140, 210, 240";
const WHITE = "225, 232, 240";

const STRIDE = 9;
const MIN_DISP = 0.005;

const REGION_ROWS = [
  ["BROW", "brow"],
  ["EYES", "eyes"],
  ["NOSE", "nose"],
  ["MOUTH", "mouth"],
  ["CHEEKS", "cheeks"],
  ["JAW", "jaw"],
] as const;

interface Props {
  frame: MutableRefObject<TrackingFrame>;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  snap: TrackingFrame;
  debug: boolean;
  fun?: boolean;
  onFreeze?: () => void;
  onResume?: () => void;
  onTimeline?: () => void;
  onExit?: () => void;
}

export default function FreeLabOverlay({
  frame,
  videoRef,
  snap,
  debug,
  fun = false,
  onFreeze,
  onResume,
  onTimeline,
  onExit,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const funRef = useRef(fun);
  useEffect(() => {
    funRef.current = fun;
  }, [fun]);
  const trail = useRef<Float32Array[]>([]);

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
      if (!video || video.readyState < 2 || f.state !== "freelab") {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        trail.current.length = 0;
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
      const lab = f.freeLab;
      if (!cur) return;
      const baseline = lab?.baseline ?? null;
      const regions = lab?.regions ?? null;
      const frozen = lab?.phase === "frozen";
      const t = performance.now() / 1000;

      const fit = coverFit(
        video.videoWidth || w,
        video.videoHeight || h,
        w,
        h,
      );
      const mirror = f.mirrored;
      const px = (p: { x: number; y: number }) => throughCover(p, fit, mirror);
      const lineCol = funRef.current ? ACCENT : WHITE;
      const quiet = lab?.phase === "stable" ? 0.5 : 1;

      if (!baseline) return;

      // --- baseline ghost --------------------------------------------------
      ctx.fillStyle = `rgba(${WHITE}, 0.12)`;
      for (let i = 0; i < baseline.length; i += STRIDE * 2) {
        const [gx, gy] = px(baseline[i]);
        ctx.beginPath();
        ctx.arc(gx, gy, dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- bounded temporal trail (last ~5 frames, decaying) ---------------
      if (!frozen) {
        trail.current.push(
          Float32Array.from(cur.flatMap((p) => [p.x, p.y])),
        );
        if (trail.current.length > 5) trail.current.shift();
      }
      const trailLen = trail.current.length;
      for (let ti = 0; ti < trailLen - 1; ti++) {
        const tp = trail.current[ti];
        const age = (trailLen - 1 - ti) / trailLen; // 0=oldest
        const ta = (1 - age) * 0.1 * quiet;
        ctx.fillStyle = `rgba(${lineCol}, ${ta})`;
        for (let i = 0; i < tp.length; i += STRIDE * 2) {
          const [tx, ty] = px({ x: tp[i], y: tp[i + 1] });
          ctx.beginPath();
          ctx.arc(tx, ty, 0.9 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // --- displacement vectors --------------------------------------------
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
        ctx.strokeStyle = `rgba(${lineCol}, ${(0.2 + strength * 0.5) * quiet})`;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        const ang = Math.atan2(by - ay, bx - ax);
        const tip = 3 * dpr;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - tip * Math.cos(ang - 0.5), by - tip * Math.sin(ang - 0.5));
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - tip * Math.cos(ang + 0.5), by - tip * Math.sin(ang + 0.5));
        ctx.stroke();
      }

      // --- regional activity pulses ----------------------------------------
      if (regions) {
        for (const [label, key] of REGION_ROWS) {
          const v = regions[key];
          if (v < 0.12) continue;
          // region centroid
          let rcx = 0, rcy = 0, rn = 0;
          for (const i of REGION_IDX[key]) {
            const p = cur[i];
            if (!p) continue;
            const [sx, sy] = px(p);
            rcx += sx;
            rcy += sy;
            rn++;
          }
          if (!rn) continue;
          rcx /= rn;
          rcy /= rn;
          const pulse = 0.6 + 0.4 * Math.sin(t * 6 + rn);
          const rr = (10 + v * 26) * dpr;
          ctx.strokeStyle = `rgba(${ACCENT}, ${v * 0.45 * pulse * quiet})`;
          ctx.lineWidth = 1.2 * dpr;
          ctx.beginPath();
          ctx.arc(rcx, rcy, rr, 0, Math.PI * 2);
          ctx.stroke();
          if (funRef.current) {
            // sparse region particles
            for (let k = 0; k < 5; k++) {
              const ang = t * 1.8 + k * 1.26;
              const pr = rr * 1.15;
              ctx.fillStyle = `rgba(${ACCENT}, ${v * 0.5 * quiet})`;
              ctx.beginPath();
              ctx.arc(
                rcx + Math.cos(ang) * pr,
                rcy + Math.sin(ang) * pr,
                1.1 * dpr,
                0,
                Math.PI * 2,
              );
              ctx.fill();
            }
            void label;
          }
        }
      }

      // --- event labels (cooldown-gated in the engine) ---------------------
      if (f.boundingBox && lab?.recentEvents.length) {
        const bb = f.boundingBox;
        const [ex, ey] = px({ x: bb.x + bb.w / 2, y: bb.y });
        const nowMs = performance.now();
        ctx.font = `${Math.max(8, 8 * dpr)}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        lab.recentEvents.forEach((ev, i) => {
          const age = nowMs - ev.at;
          if (age > 1600) return;
          const a = (1 - age / 1600) * 0.8;
          ctx.fillStyle = `rgba(${ACCENT}, ${a})`;
          ctx.fillText(ev.label, ex, ey - (14 + i * 12) * dpr);
        });
      }
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [frame, videoRef]);

  const lab = snap.freeLab;
  const regions = lab?.regions;
  const phase = lab?.phase;
  return (
    <>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      {snap.state === "freelab" && lab && (
        <>
          {/* instruction — top safe zone */}
          <div className="absolute left-1/2 top-3 w-max max-w-[92vw] -translate-x-1/2 rounded bg-black/40 px-4 py-2 text-center font-mono backdrop-blur-[2px] sm:top-4">
            <div className="text-[8px] font-medium tracking-[0.25em] text-neutral-500">
              FREE LAB
            </div>
            <div
              className={`mt-1 text-[12px] font-medium tracking-[0.2em] ${
                phase === "frozen" || phase === "stable"
                  ? "text-cyan-200"
                  : "text-neutral-100"
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

          {/* live region HUD — lower safe zone */}
          {regions && (
            <div className="absolute bottom-12 left-1/2 w-[min(78vw,300px)] -translate-x-1/2 sm:bottom-14">
              <div className="rounded bg-black/40 px-3 py-2 font-mono text-[8px] font-medium tracking-[0.14em] backdrop-blur-[2px]">
                <div className="mb-1 flex justify-between">
                  <span className="text-neutral-500">FACIAL MOTION</span>
                  <span className="text-neutral-500">
                    POSE {lab.poseMoving ? "MOVING" : "STABLE"}
                  </span>
                </div>
                {REGION_ROWS.map(([name, key]) => (
                  <div key={name} className="flex items-center gap-2">
                    <span className="w-12 text-neutral-400">{name}</span>
                    <div className="h-px flex-1 bg-neutral-800">
                      <div
                        className="h-px bg-cyan-300/80 transition-[width] duration-150"
                        style={{
                          width: `${Math.round(regions[key] * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="w-7 text-right text-neutral-500">
                      {Math.round(regions[key] * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* controls — bottom-right */}
          <div className="absolute bottom-12 right-3 flex flex-col gap-2 sm:bottom-14 sm:right-4">
            {phase !== "frozen" && onFreeze && (
              <button
                onClick={onFreeze}
                className="rounded border border-cyan-300/40 bg-black/50 px-3 py-2 font-mono text-[8px] font-medium tracking-[0.2em] text-cyan-200 backdrop-blur-[2px] transition-colors hover:bg-cyan-300/10"
              >
                FREEZE MOTION
              </button>
            )}
            {phase === "frozen" && (
              <>
                {onResume && (
                  <button
                    onClick={onResume}
                    className="rounded border border-cyan-300/40 bg-black/50 px-3 py-2 font-mono text-[8px] font-medium tracking-[0.2em] text-cyan-200 backdrop-blur-[2px] transition-colors hover:bg-cyan-300/10"
                  >
                    RESUME
                  </button>
                )}
                {onTimeline && (
                  <button
                    onClick={onTimeline}
                    className="rounded border border-cyan-300/40 bg-black/50 px-3 py-2 font-mono text-[8px] font-medium tracking-[0.2em] text-cyan-200 backdrop-blur-[2px] transition-colors hover:bg-cyan-300/10"
                  >
                    VIEW TIMELINE
                  </button>
                )}
              </>
            )}
            {onExit && (
              <button
                onClick={onExit}
                className="rounded border border-white/15 bg-black/50 px-3 py-2 font-mono text-[8px] font-medium tracking-[0.2em] text-neutral-400 backdrop-blur-[2px] transition-colors hover:text-neutral-200"
              >
                EXIT LAB
              </button>
            )}
          </div>

          {debug && (
            <div className="absolute right-2 top-2 rounded bg-black/50 px-2 py-1 font-mono text-[8px] text-neutral-400">
              <div>FREE LAB DEBUG</div>
              <div>PHASE {phase?.toUpperCase()}</div>
              <div>SAMPLES {lab.samples}</div>
              <div>MOTION {((regions?.overall ?? 0) * 100).toFixed(0)}%</div>
              <div>POSE {lab.poseMoving ? "MOVING" : "STABLE"}</div>
            </div>
          )}
        </>
      )}
    </>
  );
}
