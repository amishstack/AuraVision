"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { MESH, sparseScaffold } from "@/lib/geometry/mesh";
import { coverFit, throughCover } from "@/lib/vision/imageTransform";
import type { DuoSubject, TrackingFrame } from "@/types/vision";

/**
 * Aura Duo — two-subject geometry + a reactive center field.
 * Each subject gets a compact facial rendering (contour, eyes, brows,
 * lips, sparse scaffold). A particle field between their centers is
 * driven by the live motion-synchrony signal — a visualization of
 * temporal alignment, nothing else.
 */

const ACCENT = "140, 210, 240";
const WHITE = "225, 232, 240";

interface Props {
  frame: MutableRefObject<TrackingFrame>;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  snap: TrackingFrame;
  debug: boolean;
  fun?: boolean;
  onFinish?: () => void;
  onExit?: () => void;
}

interface Particle {
  t: number;     // 0..1 position along A→B
  off: number;   // perpendicular offset
  speed: number;
  seed: number;
}

const PARTICLES = 26;

export default function DuoOverlay({
  frame,
  videoRef,
  snap,
  debug,
  fun = false,
  onFinish,
  onExit,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const funRef = useRef(fun);
  useEffect(() => {
    funRef.current = fun;
  }, [fun]);
  const scaffold = useMemo(() => sparseScaffold(10), []);
  const particles = useMemo<Particle[]>(() => {
    // deterministic pseudo-random — stable across renders
    const r = (i: number) => {
      const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    return Array.from({ length: PARTICLES }, (_, i) => ({
      t: i / PARTICLES,
      off: (r(i * 3 + 1) - 0.5) * 0.09,
      speed: 0.12 + r(i * 3 + 2) * 0.18,
      seed: r(i * 3 + 3) * 6.28,
    }));
  }, []);
  const evt = useRef({ eA: 0, eB: 0, bothMoveAt: 0, lockAt: 0, locked: false });

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
      if (!video || video.readyState < 2 || f.state !== "duo") {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        evt.current.locked = false;
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

      const fit = coverFit(
        video.videoWidth || w,
        video.videoHeight || h,
        w,
        h,
      );
      const mirror = f.mirrored;
      const px = (p: { x: number; y: number }) => throughCover(p, fit, mirror);
      const now = performance.now();
      const t = now / 1000;
      const subs = f.duoSubjects ?? [];
      const sync = f.duo?.sync ?? null;
      const syncLevel = sync?.overall ?? 0;
      const E = evt.current;

      // event detection — simultaneous motion, duo lock
      const [A, B] = subs;
      const aMove = (A?.energy ?? 0) > 0.25;
      const bMove = (B?.energy ?? 0) > 0.25;
      if (aMove) E.eA = now;
      if (bMove) E.eB = now;
      if (aMove && bMove && now - E.bothMoveAt > 1200) E.bothMoveAt = now;
      if ((f.duo?.lockProgress ?? 0) >= 1 && !E.locked) {
        E.locked = true;
        E.lockAt = now;
      }
      if ((f.duo?.lockProgress ?? 0) < 0.9) E.locked = false;

      // --- per-subject geometry ------------------------------------------
      const drawSubject = (s: DuoSubject | null, label: string) => {
        if (!s?.landmarks) return;
        const lm = s.landmarks;
        const drawEdges = (
          edges: readonly { start: number; end: number }[],
          col: string,
          alpha: number,
          lw: number,
        ) => {
          ctx.strokeStyle = `rgba(${col}, ${alpha})`;
          ctx.lineWidth = lw * dpr;
          ctx.beginPath();
          for (const ed of edges) {
            const a = lm[ed.start];
            const b = lm[ed.end];
            if (!a || !b) continue;
            const [eax, eay] = px(a);
            const [ebx, eby] = px(b);
            ctx.moveTo(eax, eay);
            ctx.lineTo(ebx, eby);
          }
          ctx.stroke();
        };
        drawEdges(scaffold, WHITE, 0.08, 0.5);
        drawEdges(MESH.contours, WHITE, 0.22, 0.7);
        drawEdges(MESH.lips, WHITE, 0.55, 1);
        drawEdges(MESH.leftEye, WHITE, 0.55, 0.9);
        drawEdges(MESH.rightEye, WHITE, 0.55, 0.9);
        drawEdges(MESH.leftBrow, WHITE, 0.5, 0.9);
        drawEdges(MESH.rightBrow, WHITE, 0.5, 0.9);
        drawEdges(MESH.faceOval, WHITE, 0.7, 1.1);

        // subject label chip
        if (s.boundingBox) {
          const bb = s.boundingBox;
          const [tcx, tcy] = px({ x: bb.x + bb.w / 2, y: bb.y });
          const tag = `${label} ${s.present ? "— GEOMETRY LOCKED" : ""}`;
          ctx.font = `${Math.max(7, 7 * dpr)}px ui-monospace, monospace`;
          ctx.textAlign = "center";
          ctx.fillStyle = `rgba(${WHITE}, 0.75)`;
          ctx.fillText(tag, tcx, tcy - 10 * dpr);
        }
      };
      drawSubject(A ?? null, "SUBJECT A");
      drawSubject(B ?? null, "SUBJECT B");

      // --- reactive center field -----------------------------------------
      const pa = A?.boundingBox
        ? px({
            x: A.boundingBox.x + A.boundingBox.w / 2,
            y: A.boundingBox.y + A.boundingBox.h / 2,
          })
        : null;
      const pb = B?.boundingBox
        ? px({
            x: B.boundingBox.x + B.boundingBox.w / 2,
            y: B.boundingBox.y + B.boundingBox.h / 2,
          })
        : null;

      if (pa && pb) {
        const dx = pb[0] - pa[0];
        const dy = pb[1] - pa[1];
        const len = Math.hypot(dx, dy);
        const nx = -dy / (len || 1);
        const ny = dx / (len || 1);
        const fieldA = 0.1 + syncLevel * 0.45;
        const fieldW = (14 + (1 - syncLevel) * 26) * dpr;

        // particles drift A↔B; synchronized motion brightens + tightens
        const speedMul = 0.4 + syncLevel * 0.8;
        for (const p of particles) {
          p.t += p.speed * speedMul * 0.016 * (p.seed > 3.14 ? 1 : -1);
          if (p.t > 1) p.t -= 1;
          if (p.t < 0) p.t += 1;
          const wob = Math.sin(t * 1.7 + p.seed) * fieldW * p.off * 10;
          const xx = pa[0] + dx * p.t + nx * wob;
          const yy = pa[1] + dy * p.t + ny * wob;
          ctx.fillStyle = `rgba(${ACCENT}, ${fieldA * (0.4 + 0.6 * Math.abs(Math.sin(p.seed)))})`;
          ctx.beginPath();
          ctx.arc(xx, yy, 1.1 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }

        // soft center glow when synchrony is high
        if (syncLevel > 0.55) {
          const mx = pa[0] + dx / 2;
          const my = pa[1] + dy / 2;
          const g = ctx.createRadialGradient(mx, my, 0, mx, my, len * 0.28);
          g.addColorStop(0, `rgba(${ACCENT}, ${(syncLevel - 0.5) * 0.35})`);
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.fillRect(mx - len * 0.3, my - len * 0.3, len * 0.6, len * 0.6);
        }

        // event pulses — simultaneous movement → center pulse; lock →
        // expanding field ring
        if (funRef.current) {
          const bothAge = now - E.bothMoveAt;
          if (bothAge < 700) {
            const rr = len * 0.1 + (bothAge / 700) * len * 0.25;
            ctx.strokeStyle = `rgba(${ACCENT}, ${(1 - bothAge / 700) * 0.45})`;
            ctx.lineWidth = dpr;
            ctx.beginPath();
            ctx.arc(pa[0] + dx / 2, pa[1] + dy / 2, rr, 0, Math.PI * 2);
            ctx.stroke();
          }
          const lockAge = now - E.lockAt;
          if (lockAge < 1200) {
            const rr = len * (0.15 + (lockAge / 1200) * 0.6);
            ctx.strokeStyle = `rgba(${ACCENT}, ${(1 - lockAge / 1200) * 0.5})`;
            ctx.lineWidth = 1.4 * dpr;
            ctx.beginPath();
            ctx.arc(pa[0] + dx / 2, pa[1] + dy / 2, rr, 0, Math.PI * 2);
            ctx.stroke();
          }
          // per-side ripples
          for (const [c, at] of [
            [pa, E.eA],
            [pb, E.eB],
          ] as const) {
            const age = now - at;
            if (age < 500) {
              ctx.strokeStyle = `rgba(${ACCENT}, ${(1 - age / 500) * 0.35})`;
              ctx.beginPath();
              ctx.arc(c[0], c[1], (8 + age * 0.08) * dpr, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
        }
      }
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [frame, videoRef, scaffold, particles]);

  const duo = snap.duo;
  return (
    <>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      {snap.state === "duo" && (
        <>
          {/* status — top safe zone */}
          <div className="absolute left-1/2 top-3 w-max max-w-[92vw] -translate-x-1/2 rounded bg-black/40 px-4 py-2 text-center font-mono backdrop-blur-[2px] sm:top-4">
            <div className="text-[8px] font-medium tracking-[0.25em] text-neutral-500">
              AURA DUO
            </div>
            <div className="mt-1 text-[12px] font-medium tracking-[0.2em] text-neutral-100">
              {!duo || duo.count === 0
                ? "SEARCHING FOR SUBJECTS"
                : duo.count === 1
                  ? "ONE SUBJECT DETECTED — ADD ONE MORE"
                  : (duo.lockProgress ?? 0) >= 1
                    ? "DUO LOCKED"
                    : "SUBJECTS TRACKED"}
            </div>
            {duo && duo.count === 2 && duo.lockProgress > 0 && (
              <div className="mx-auto mt-1.5 h-px w-24 bg-neutral-800">
                <div
                  className="h-px bg-cyan-300 transition-[width] duration-100"
                  style={{ width: `${duo.lockProgress * 100}%` }}
                />
              </div>
            )}
          </div>

          {/* synchrony readout — lower safe zone */}
          {duo?.sync && (
            <div className="absolute bottom-12 left-1/2 w-[min(78vw,300px)] -translate-x-1/2 sm:bottom-14">
              <div className="rounded bg-black/40 px-3 py-2 font-mono text-[8px] font-medium tracking-[0.14em] backdrop-blur-[2px]">
                <div className="mb-1 text-neutral-500">MOTION SYNCHRONY</div>
                {(
                  [
                    ["HEAD", duo.sync.head],
                    ["GAZE", duo.sync.gaze],
                    ["MOTION", duo.sync.motion],
                    ["TEMPORAL", duo.sync.overall],
                  ] as const
                ).map(([name, v]) => (
                  <div key={name} className="flex items-center gap-2">
                    <span className="w-14 text-neutral-400">{name}</span>
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

          {/* mode controls — bottom-right safe zone */}
          <div className="absolute bottom-12 right-3 flex flex-col gap-2 sm:bottom-14 sm:right-4">
            {duo && duo.count === 2 && onFinish && (
              <button
                onClick={onFinish}
                className="rounded border border-cyan-300/40 bg-black/50 px-3 py-2 font-mono text-[8px] font-medium tracking-[0.2em] text-cyan-200 backdrop-blur-[2px] transition-colors hover:bg-cyan-300/10"
              >
                FINISH
              </button>
            )}
            {onExit && (
              <button
                onClick={onExit}
                className="rounded border border-white/15 bg-black/50 px-3 py-2 font-mono text-[8px] font-medium tracking-[0.2em] text-neutral-400 backdrop-blur-[2px] transition-colors hover:text-neutral-200"
              >
                EXIT
              </button>
            )}
          </div>

          {debug && (
            <div className="absolute right-2 top-2 rounded bg-black/50 px-2 py-1 font-mono text-[8px] text-neutral-400">
              <div>DUO DEBUG</div>
              <div>FACES {duo?.count ?? 0}</div>
              <div>
                SYNC {duo?.sync ? (duo.sync.overall * 100).toFixed(0) + "%" : "—"}
              </div>
              <div>LOCK {Math.round((duo?.lockProgress ?? 0) * 100)}%</div>
            </div>
          )}
        </>
      )}
    </>
  );
}
