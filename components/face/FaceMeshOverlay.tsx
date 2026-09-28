"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { MESH, sparseScaffold, faceTriangles } from "@/lib/geometry/mesh";
import type { Connection } from "@/lib/geometry/mesh";
import { computeDepthField } from "@/lib/depth/depth";
import { coverFit, throughCover } from "@/lib/vision/imageTransform";
import type { TrackingFrame } from "@/types/vision";

/**
 * Layer B — facial intelligence renderer.
 *
 * Hierarchical geometry:
 *   L1 face oval          strongest — clean silhouette
 *   L2 features           eyes / brows / lips / iris — medium
 *   L3 secondary contours faint facial topology
 *   L4 sparse scaffold    internal mesh, very faint
 *   L5 relative depth     scaffold intensity modulated by z
 *
 * Plus gaze vectors, bounding brackets, deep-scan sweep, and a staged
 * initialization emergence driven by frame.initProgress.
 *
 * Runs its own rAF; reads the mutable TrackingFrame directly.
 */

const ACCENT = "140, 210, 240"; // restrained technical cyan
const WHITE = "225, 232, 240";

const L_IRIS = 468, R_IRIS = 473;
const NOSE_TIP = 4;
const NOSE_BRIDGE = 6;

interface Props {
  frame: MutableRefObject<TrackingFrame>;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  debug: boolean;
  fun?: boolean;
}

export default function FaceMeshOverlay({ frame, videoRef, debug, fun = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const debugRef = useRef(debug);
  const funRef = useRef(fun);
  useEffect(() => {
    debugRef.current = debug;
    funRef.current = fun;
  }, [debug, fun]);
  const scaffold = useMemo(() => sparseScaffold(6), []);
  const triangles = useMemo(() => faceTriangles(), []);
  const env = useRef(0);
  const lockBlend = useRef(0);
  const funPrev = useRef(false);
  const funBurstAt = useRef(0);
  const depthCache = useRef<Float32Array | null>(null);
  const depthStamp = useRef(0);
  // Adaptive detail — surface triangle stride relaxes if drawing is slow.
  const renderMsEma = useRef(0);
  const triStride = useRef(1);
  const triOrder = useRef<Uint32Array | null>(null);

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
      if (!video || video.readyState < 2) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
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

      if (!f.landmarks || f.landmarks.length === 0) {
        env.current = Math.max(0, env.current - 0.04);
        lockBlend.current = Math.max(0, lockBlend.current - 0.03);
        return;
      }

      const hasFace = f.state !== "searching" && f.state !== "lost";
      env.current += ((hasFace ? 1 : 0) - env.current) * 0.08;
      lockBlend.current +=
        ((f.state === "locked" ? 1 : 0) - lockBlend.current) * 0.05;
      const occlFade = f.occluded ? 0.55 : 1;
      const e = env.current * occlFade;
      if (e < 0.02) return;

      // object-cover mapping (element may crop the source frame) —
      // canonical transform shared with all other visual consumers
      const fit = coverFit(
        video.videoWidth || w,
        video.videoHeight || h,
        w,
        h,
      );
      const { dispW, dispH, offX, offY } = fit;
      const mirror = f.mirrored;
      const px = (p: { x: number; y: number }) => throughCover(p, fit, mirror);

      const lock = lockBlend.current;
      const lm = f.landmarks;
      const init = f.initProgress;

      // Staged emergence during the initializing state.
      const sNodes = stage(init, 0.0, 0.25);
      const sOval = stage(init, 0.2, 0.45);
      const sFeat = stage(init, 0.4, 0.65);
      const sMesh = stage(init, 0.6, 0.85);
      const sFrame = stage(init, 0.75, 1.0);

      // Relative depth field — recomputed ~10 Hz, cached otherwise.
      if (!depthCache.current || depthStamp.current++ % 6 === 0) {
        depthCache.current = computeDepthField(lm)?.relative ?? null;
      }
      const depth = depthCache.current;
      const drawStart = performance.now();

      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // --- L5 translucent pseudo-3D surface -----------------------------
      // Painter-sorted triangles, shaded by screen-space normal facing
      // and relative depth — reads as a faint geometric surface that
      // reprojects naturally as the head turns.
      if (sMesh > 0.4 && depth) {
        const tris = triangles;
        if (!triOrder.current || triOrder.current.length !== tris.length) {
          triOrder.current = new Uint32Array(tris.length);
          for (let i = 0; i < tris.length; i++) triOrder.current[i] = i;
        }
        const order = triOrder.current;
        const zAvg = (i: number) =>
          (depth[tris[i][0]] + depth[tris[i][1]] + depth[tris[i][2]]) / 3;
        order.sort((a, b) => zAvg(b) - zAvg(a)); // far → near

        const stride = triStride.current;
        const baseA = (0.05 + 0.07 * lock) * e * sMesh;
        for (let k = 0; k < tris.length; k += stride) {
          const t = tris[order[k]];
          const A = lm[t[0]], B = lm[t[1]], C = lm[t[2]];
          if (!A || !B || !C) continue;
          const [ax, ay] = px(A);
          const [bx, by] = px(B);
          const [cx, cy] = px(C);
          // pseudo-3D: use -z*dispW as the third screen coordinate
          const za = -A.z * dispW, zb = -B.z * dispW, zc = -C.z * dispW;
          const ux = bx - ax, uy = by - ay, uz = zb - za;
          const vx = cx - ax, vy = cy - ay, vz = zc - za;
          const nz = ux * vy - uy * vx;
          const nx = uy * vz - uz * vy;
          const ny = uz * vx - ux * vz;
          const nlen = Math.hypot(nx, ny, nz) || 1;
          const facing = Math.max(0, nz / nlen);
          const rel = (depth[t[0]] + depth[t[1]] + depth[t[2]]) / 3;
          const alpha = baseA * (0.3 + 0.7 * facing) * (1.15 - 0.6 * rel);
          if (alpha <= 0.004) continue;
          ctx.fillStyle = `rgba(${ACCENT}, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.lineTo(cx, cy);
          ctx.closePath();
          ctx.fill();
        }
      }

      const drawEdges = (
        edges: Connection[], color: string, alpha: number, width: number,
      ) => {
        if (alpha <= 0.005) return;
        ctx.strokeStyle = `rgba(${color}, ${alpha})`;
        ctx.lineWidth = width * dpr;
        ctx.beginPath();
        for (const ed of edges) {
          const a = lm[ed.start], b = lm[ed.end];
          if (!a || !b) continue;
          const [ax, ay] = px(a);
          const [bx, by] = px(b);
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
        }
        ctx.stroke();
      };

      // Depth-modulated scaffold — near geometry brighter.
      const drawScaffold = (alpha: number, width: number) => {
        if (alpha <= 0.005) return;
        ctx.lineWidth = width * dpr;
        for (const ed of scaffold) {
          const a = lm[ed.start], b = lm[ed.end];
          if (!a || !b) continue;
          const rel = depth ? 1 - (depth[ed.start] + depth[ed.end]) / 2 : 0.5;
          ctx.strokeStyle = `rgba(${ACCENT}, ${alpha * (0.35 + 0.65 * rel)})`;
          ctx.beginPath();
          const [ax, ay] = px(a);
          const [bx, by] = px(b);
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
      };

      // FUN mode: breathing shimmer + cyan feature treatment.
      // Pulse strength tracks real temporal stability — reactive, not
      // constant.
      const isFun = funRef.current;
      const funAmp = isFun
        ? 1 + 0.30 * Math.sin(performance.now() * 0.0022) *
            (0.6 + 0.4 * (f.metrics?.stability ?? 0.5))
        : 1;
      const featCol = isFun ? ACCENT : WHITE;

      // --- L4 interior scaffold (depth field) ---------------------------
      drawScaffold((0.10 + 0.16 * lock) * e * sMesh * funAmp, 0.6);

      // --- L3 secondary contours ---------------------------------------
      drawEdges(MESH.contours, ACCENT, (0.13 + 0.10 * lock) * e * sFeat * funAmp, 0.7);

      // --- L2 features ---------------------------------------------------
      const featA = (0.34 + 0.30 * lock) * e * sFeat * funAmp;
      drawEdges(MESH.leftEye, featCol, featA, 1.0);
      drawEdges(MESH.rightEye, featCol, featA, 1.0);
      drawEdges(MESH.lips, featCol, featA, 1.0);
      drawEdges(MESH.leftBrow, ACCENT, featA * 0.8, 0.9);
      drawEdges(MESH.rightBrow, ACCENT, featA * 0.8, 0.9);
      if (!f.occluded) {
        drawEdges(MESH.leftIris, ACCENT, featA * 0.9, 0.9);
        drawEdges(MESH.rightIris, ACCENT, featA * 0.9, 0.9);
      }

      // --- nose bridge emphasis (depth anchor) --------------------------
      if (lm[NOSE_BRIDGE] && depth) {
        const [nx, ny] = px(lm[NOSE_TIP]);
        const [bx, by] = px(lm[NOSE_BRIDGE]);
        ctx.strokeStyle = `rgba(${WHITE}, ${0.20 * e * sFeat})`;
        ctx.lineWidth = 1.1 * dpr;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(nx, ny);
        ctx.stroke();
      }

      // --- FUN: activation burst + ambient twinkle/scan arc --------------
      if (funRef.current && !funPrev.current) {
        funBurstAt.current = performance.now();
      }
      funPrev.current = funRef.current;
      const burstT = funBurstAt.current
        ? Math.min((performance.now() - funBurstAt.current) / 1100, 1)
        : 1;

      if (funRef.current && e > 0.3) {
        const t = performance.now() * 0.001;
        const burstBoost = 1 + (1 - burstT); // denser/brighter during burst

        // traveling pulse through the mesh — scaffold subset brightens
        // on a radial wave from the face center (~2.5s cycle)
        if (f.boundingBox) {
          const bb = f.boundingBox;
          const [fcx, fcy] = px({ x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 });
          ctx.strokeStyle = `rgba(${ACCENT}, 0.14)`;
          ctx.lineWidth = 0.7 * dpr;
          ctx.beginPath();
          for (let i = 0; i < scaffold.length; i += 3) {
            const ed = scaffold[i];
            const A = lm[ed.start], B = lm[ed.end];
            if (!A || !B) continue;
            const [ax, ay] = px(A);
            const [bx, by] = px(B);
            const d = Math.hypot((ax + bx) / 2 - fcx, (ay + by) / 2 - fcy);
            const wave = Math.sin(t * 2.4 - d * 0.006);
            if (wave < 0.55) continue;
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
          }
          ctx.stroke();
        }

        // eye-region highlight — a short bright segment slides along
        // each eye contour loop
        for (const set of [MESH.leftEye, MESH.rightEye]) {
          const L = set.length;
          const head = Math.floor((t * 9) % L);
          for (let k = 0; k < 4; k++) {
            const ed = set[(head + k) % L];
            const A = lm[ed.start], B = lm[ed.end];
            if (!A || !B) continue;
            const [ax, ay] = px(A);
            const [bx, by] = px(B);
            ctx.strokeStyle = `rgba(${ACCENT}, ${0.4 * (1 - k / 4) * e})`;
            ctx.lineWidth = 1.1 * dpr;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
          }
        }

        // mouth pulse — lip outline brightens with real mouth dynamics
        const mouth = f.dynamics?.mouthAperture ?? 0;
        if (mouth > 0.12) {
          ctx.strokeStyle = `rgba(${ACCENT}, ${Math.min(0.5, mouth * 0.9) * e})`;
          ctx.lineWidth = 1.4 * dpr;
          ctx.beginPath();
          for (const ed of MESH.lips) {
            const A = lm[ed.start], B = lm[ed.end];
            if (!A || !B) continue;
            const [ax, ay] = px(A);
            const [bx, by] = px(B);
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
          }
          ctx.stroke();
        }

        // gaze marker — small indicator offset by the real gaze vector
        if (f.gaze && f.gaze.confidence > 0.4 && f.boundingBox) {
          const bb0 = f.boundingBox;
          const [gcx, gcy] = px({
            x: bb0.x + bb0.w / 2,
            y: bb0.y + bb0.h / 2,
          });
          const gx = gcx + f.gaze.dx * 34 * dpr;
          const gy = gcy + f.gaze.dy * 34 * dpr;
          ctx.strokeStyle = `rgba(${ACCENT}, ${0.45 * e})`;
          ctx.lineWidth = dpr;
          ctx.beginPath();
          ctx.arc(gx, gy, 3.2 * dpr, 0, Math.PI * 2);
          ctx.stroke();
        }

        // landmark twinkle
        for (let i = 0; i < lm.length; i += burstT < 1 ? 12 : 24) {
          const tw = 0.5 + 0.5 * Math.sin(t * 2.4 + i * 1.7);
          if (tw < 0.55) continue;
          const [x, y] = px(lm[i]);
          ctx.fillStyle = `rgba(${ACCENT}, ${Math.min(1, 0.4 * tw * e * burstBoost)})`;
          ctx.fillRect(x - dpr, y - dpr, 2 * dpr, 2 * dpr);
        }

        if (f.boundingBox) {
          const bb = f.boundingBox;
          const [bcx, bcy] = px({ x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 });
          const rBase = Math.max(bb.w * dispW, bb.h * dispH);

          // activation signature: one cyan ring expands once around the
          // face and fades; ambient ring + sweep + particles while on
          if (burstT < 1) {
            const rb = rBase * (0.35 + 1.15 * burstT);
            ctx.strokeStyle = `rgba(${ACCENT}, ${(1 - burstT) * 0.55 * e})`;
            ctx.lineWidth = 1.4 * dpr;
            ctx.beginPath();
            ctx.arc(bcx, bcy, rb, 0, Math.PI * 2);
            ctx.stroke();
          }

          // faint persistent orbit ring + slow sweep arc (~5s
          // rotation); ring radius responds gently to head yaw
          const yawResp = 1 + Math.min(0.08, Math.abs(f.pose?.yawDeg ?? 0) * 0.002);
          const r = rBase * 0.62 * yawResp;
          ctx.strokeStyle = `rgba(${ACCENT}, ${0.07 * e})`;
          ctx.lineWidth = dpr;
          ctx.beginPath();
          ctx.arc(bcx, bcy, r, 0, Math.PI * 2);
          ctx.stroke();
          const a0 = t * 1.15 + (f.pose?.yawDeg ?? 0) * 0.01;
          ctx.strokeStyle = `rgba(${ACCENT}, ${0.34 * e})`;
          ctx.beginPath();
          ctx.arc(bcx, bcy, r, a0, a0 + 0.9);
          ctx.stroke();

          // sparse particles drifting on the ring
          for (let i = 0; i < 10; i++) {
            const pa = t * 0.32 + i * 0.63;
            const pr = r * (0.92 + 0.16 * Math.sin(i * 1.9 + t * 0.5));
            const pxp = bcx + Math.cos(pa) * pr;
            const pyp = bcy + Math.sin(pa) * pr * 0.88;
            const pa2 = 0.14 + 0.12 * Math.sin(t * 1.6 + i * 2.3);
            ctx.fillStyle = `rgba(${ACCENT}, ${Math.max(0.02, pa2) * e})`;
            ctx.fillRect(pxp - dpr * 0.8, pyp - dpr * 0.8, 1.6 * dpr, 1.6 * dpr);
          }

          // periodic vertical sweep band across the face (~4.5s period)
          const sp = (t % 4.5) / 4.5;
          const [bxA] = px({ x: bb.x, y: 0 });
          const [bxB] = px({ x: bb.x + bb.w, y: 0 });
          const bx0 = Math.min(bxA, bxB); // displayed left edge (mirror-safe)
          const swpX = bx0 + sp * bb.w * dispW;
          const [, bcyTop] = px({ x: 0, y: bb.y });
          const bh = bb.h * dispH;
          const grad = ctx.createLinearGradient(swpX - 14 * dpr, 0, swpX + 14 * dpr, 0);
          grad.addColorStop(0, `rgba(${ACCENT}, 0)`);
          grad.addColorStop(0.5, `rgba(${ACCENT}, ${0.10 * e})`);
          grad.addColorStop(1, `rgba(${ACCENT}, 0)`);
          ctx.fillStyle = grad;
          ctx.fillRect(swpX - 14 * dpr, bcyTop, 28 * dpr, bh);
        }
      }

      // --- L1 face silhouette -------------------------------------------
      drawEdges(MESH.faceOval, WHITE, (0.30 + 0.38 * lock) * e * sOval * funAmp, 1.2);

      // --- subtle surface tint inside the oval ---------------------------
      if (lock > 0.25 && f.boundingBox) {
        const bb = f.boundingBox;
        const cx = offX + (mirror ? 1 - (bb.x + bb.w / 2) : bb.x + bb.w / 2) * dispW;
        const cy = offY + (bb.y + bb.h / 2) * dispH;
        const rx = (bb.w / 2) * dispW * 1.02;
        const ry = (bb.h / 2) * dispH * 1.06;
        const grad = ctx.createRadialGradient(
          cx, cy, Math.min(rx, ry) * 0.15, cx, cy, Math.max(rx, ry),
        );
        grad.addColorStop(0, `rgba(${ACCENT}, ${0.02 * lock * e})`);
        grad.addColorStop(1, `rgba(${ACCENT}, ${0.005 * lock * e})`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- gaze vectors ---------------------------------------------------
      if (f.gaze && f.gaze.confidence > 0.35 && !f.occluded && sFeat > 0.5) {
        const g = f.gaze;
        const len = 26 * dpr * Math.min(1, Math.hypot(g.dx, g.dy) + 0.4);
        // g.dx is already in screen space (mirror-corrected upstream).
        const vx = g.dx * len;
        const vy = g.dy * len;
        ctx.strokeStyle = `rgba(${ACCENT}, ${0.4 * e * g.confidence})`;
        ctx.lineWidth = 1 * dpr;
        for (const idx of [L_IRIS, R_IRIS]) {
          if (!lm[idx]) continue;
          const [ix, iy] = px(lm[idx]);
          ctx.beginPath();
          ctx.moveTo(ix, iy);
          ctx.lineTo(ix + vx, iy + vy);
          ctx.stroke();
        }
      }

      // --- symmetry analysis ghost (Deep Analysis phase 2) ---------------
      if (f.symmetryField) {
        // mirrored ghost: reflect landmarks about the face's mean-x axis
        let axis = 0;
        for (const p of lm) axis += p.x;
        axis /= lm.length;
        const mx = (p: { x: number; y: number }) =>
          [offX + (mirror ? 1 - (2 * axis - p.x) : 2 * axis - p.x) * dispW,
           offY + p.y * dispH] as const;
        ctx.strokeStyle = `rgba(${WHITE}, 0.16 * e)`;
        ctx.lineWidth = 0.8 * dpr;
        ctx.beginPath();
        for (const set of [MESH.faceOval, MESH.leftEye, MESH.rightEye, MESH.lips]) {
          for (const ed of set) {
            const a = lm[ed.start], b = lm[ed.end];
            if (!a || !b) continue;
            const [ax2, ay2] = mx(a);
            const [bx2, by2] = mx(b);
            ctx.moveTo(ax2, ay2);
            ctx.lineTo(bx2, by2);
          }
        }
        ctx.stroke();
        // symmetry field: ticks where left/right geometry deviates
        for (let i = 0; i < lm.length; i += 2) {
          const dev = f.symmetryField[i] ?? 0;
          if (dev < 0.35) continue;
          const [x, y] = px(lm[i]);
          const l = (2 + dev * 7) * dpr;
          ctx.strokeStyle = `rgba(${ACCENT}, ${0.15 + 0.5 * dev})`;
          ctx.lineWidth = dpr;
          ctx.beginPath();
          ctx.moveTo(x, y - l / 2);
          ctx.lineTo(x, y + l / 2);
          ctx.stroke();
        }
      }

      // --- landmark nodes during acquisition ------------------------------
      if (f.state === "detected" || f.state === "initializing") {
        ctx.fillStyle = `rgba(${WHITE}, ${0.55 * e * sNodes})`;
        for (let i = 0; i < lm.length; i += 2) {
          const [x, y] = px(lm[i]);
          ctx.fillRect(x - dpr, y - dpr, 2 * dpr, 2 * dpr);
        }
      }

      // --- bounding corner brackets ---------------------------------------
      if (f.boundingBox && sFrame > 0) {
        const bb = f.boundingBox;
        const bx = offX + (mirror ? 1 - bb.x - bb.w : bb.x) * dispW;
        const by = offY + bb.y * dispH;
        const bw = bb.w * dispW;
        const bh = bb.h * dispH;
        const pad = 10 * dpr;
        const len = 14 * dpr;
        ctx.strokeStyle = `rgba(${ACCENT}, ${0.5 * e * sFrame})`;
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        for (const [cx, cy, sx, sy] of [
          [bx - pad, by - pad, 1, 1],
          [bx + bw + pad, by - pad, -1, 1],
          [bx - pad, by + bh + pad, 1, -1],
          [bx + bw + pad, by + bh + pad, -1, -1],
        ] as const) {
          ctx.moveTo(cx, cy + sy * len);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx + sx * len, cy);
        }
        ctx.stroke();

        // --- deep-analysis sweep line ------------------------------------
        if (f.state === "analysis") {
          const sy = by + bh * (0.1 + 0.8 * (f.scanProgress % 1));
          ctx.strokeStyle = `rgba(${ACCENT}, 0.35)`;
          ctx.lineWidth = 1 * dpr;
          ctx.beginPath();
          ctx.moveTo(bx - pad, sy);
          ctx.lineTo(bx + bw + pad, sy);
          ctx.stroke();
        }
      }

      // adaptive detail: relax surface density if drawing is expensive
      const drawMs = performance.now() - drawStart;
      renderMsEma.current = renderMsEma.current * 0.9 + drawMs * 0.1;
      if (renderMsEma.current > 7 && triStride.current < 4) {
        triStride.current *= 2;
      } else if (renderMsEma.current < 3 && triStride.current > 1) {
        triStride.current = Math.max(1, triStride.current / 2);
      }

      // --- debug layer ------------------------------------------------------
      if (debugRef.current && f.rawLandmarks) {
        ctx.fillStyle = "rgba(255, 120, 80, 0.8)";
        for (const p of f.rawLandmarks) {
          const [x, y] = px(p);
          ctx.fillRect(x - dpr, y - dpr, 2 * dpr, 2 * dpr);
        }
        if (f.boundingBox) {
          const bb = f.boundingBox;
          const bx = offX + (mirror ? 1 - bb.x - bb.w : bb.x) * dispW;
          ctx.strokeStyle = "rgba(255, 120, 80, 0.6)";
          ctx.lineWidth = dpr;
          ctx.strokeRect(
            bx, offY + bb.y * dispH, bb.w * dispW, bb.h * dispH,
          );
        }
      }
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [frame, videoRef, scaffold, triangles]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      aria-hidden
    />
  );
}

function stage(p: number, a: number, b: number): number {
  if (p <= a) return 0;
  if (p >= b) return 1;
  const t = (p - a) / (b - a);
  return t * t * (3 - 2 * t); // smoothstep
}
