"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { MESH, sparseScaffold } from "@/lib/geometry/mesh";
import type { TrackingFrame } from "@/types/vision";

/**
 * Canvas overlay that renders the reconstructed facial geometry every
 * rAF tick, reading directly from the mutable TrackingFrame — no React
 * involvement in the hot path.
 *
 * Visual tiers (production):
 *   - sparse scaffold: faint interior structure
 *   - feature contours: eyes / brows / lips emphasized
 *   - face oval: strongest line, anchors the silhouette
 *   - bounding corners + tiny landmark nodes during acquisition
 *
 * Debug mode additionally draws raw landmark dots, the bounding box and
 * a scan grid.
 */

const CYAN = "140, 210, 240"; // restrained accent
const WHITE = "225, 232, 240";

interface Props {
  frame: MutableRefObject<TrackingFrame>;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  debug: boolean;
  className?: string;
}

export default function FaceMeshOverlay({ frame, videoRef, debug, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const debugRef = useRef(debug);
  useEffect(() => {
    debugRef.current = debug;
  }, [debug]);
  const scaffold = useMemo(() => sparseScaffold(6), []);

  // Appearance envelope — fades the mesh in on acquisition, out on loss.
  const alphaEnv = useRef(0);
  const lockBlend = useRef(0);

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

      // Match canvas pixel size to the video element's rendered box.
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
        alphaEnv.current = Math.max(0, alphaEnv.current - 0.04);
        lockBlend.current = Math.max(0, lockBlend.current - 0.03);
        return;
      }

      // Envelope smoothing for cinematic transitions between states.
      const hasFace = f.state !== "searching";
      alphaEnv.current += ((hasFace ? 1 : 0) - alphaEnv.current) * 0.08;
      lockBlend.current += ((f.state === "locked" ? 1 : 0) - lockBlend.current) * 0.05;
      const env = alphaEnv.current;
      if (env < 0.02) return;

      // object-fit: cover mapping — the element may crop the source
      // frame, so normalized landmark coords must be scaled by the
      // covered region and offset by the crop, not the element box.
      const vw = video.videoWidth || w;
      const vh = video.videoHeight || h;
      const coverScale = Math.max(w / vw, h / vh);
      const dispW = vw * coverScale;
      const dispH = vh * coverScale;
      const offX = (w - dispW) / 2;
      const offY = (h - dispH) / 2;

      const lock = lockBlend.current;
      const lm = f.landmarks;
      const mirror = f.mirrored;
      const px = (p: { x: number; y: number }) =>
        [offX + (mirror ? 1 - p.x : p.x) * dispW, offY + p.y * dispH] as const;
      const bwScale = dispW;
      const bhScale = dispH;

      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      const drawEdges = (
        edges: { start: number; end: number }[],
        color: string,
        alpha: number,
        width: number,
      ) => {
        if (alpha <= 0.005) return;
        ctx.strokeStyle = `rgba(${color}, ${alpha})`;
        ctx.lineWidth = width * dpr;
        ctx.beginPath();
        for (const e of edges) {
          const a = lm[e.start];
          const b = lm[e.end];
          if (!a || !b) continue;
          const [ax, ay] = px(a);
          const [bx, by] = px(b);
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
        }
        ctx.stroke();
      };

      // --- interior scaffold -----------------------------------------
      drawEdges(scaffold, CYAN, (0.05 + 0.10 * lock) * env, 0.6);

      // --- feature contours ------------------------------------------
      const featAlpha = (0.34 + 0.30 * lock) * env;
      drawEdges(MESH.leftEye, WHITE, featAlpha, 1.0);
      drawEdges(MESH.rightEye, WHITE, featAlpha, 1.0);
      drawEdges(MESH.leftBrow, CYAN, featAlpha * 0.8, 0.9);
      drawEdges(MESH.rightBrow, CYAN, featAlpha * 0.8, 0.9);
      drawEdges(MESH.lips, WHITE, featAlpha, 1.0);
      drawEdges(MESH.leftIris, CYAN, featAlpha, 0.9);
      drawEdges(MESH.rightIris, CYAN, featAlpha, 0.9);
      drawEdges(MESH.contours, CYAN, featAlpha * 0.35, 0.7);

      // --- face silhouette -------------------------------------------
      drawEdges(MESH.faceOval, WHITE, (0.30 + 0.38 * lock) * env, 1.2);

      // --- translucent surface tint inside the oval ------------------
      if (lock > 0.25 && f.boundingBox) {
        const bb = f.boundingBox;
        const cx = offX + (mirror ? 1 - (bb.x + bb.w / 2) : bb.x + bb.w / 2) * bwScale;
        const cy = offY + (bb.y + bb.h / 2) * bhScale;
        const rx = (bb.w / 2) * bwScale * 1.02;
        const ry = (bb.h / 2) * bhScale * 1.06;
        const grad = ctx.createRadialGradient(cx, cy, Math.min(rx, ry) * 0.15, cx, cy, Math.max(rx, ry));
        grad.addColorStop(0, `rgba(${CYAN}, ${0.02 * lock * env})`);
        grad.addColorStop(1, `rgba(${CYAN}, ${0.005 * lock * env})`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- landmark nodes during acquisition -------------------------
      if (f.state === "detected") {
        ctx.fillStyle = `rgba(${WHITE}, ${0.7 * env})`;
        for (let i = 0; i < lm.length; i += 2) {
          const [x, y] = px(lm[i]);
          ctx.fillRect(x - dpr, y - dpr, 2 * dpr, 2 * dpr);
        }
      }

      // --- bounding corner brackets ----------------------------------
      if (f.boundingBox) {
        const bb = f.boundingBox;
        const bx = offX + (mirror ? 1 - bb.x - bb.w : bb.x) * bwScale;
        const by = offY + bb.y * bhScale;
        const bw = bb.w * bwScale;
        const bh = bb.h * bhScale;
        const pad = 10 * dpr;
        const len = 14 * dpr;
        ctx.strokeStyle = `rgba(${CYAN}, ${0.5 * env})`;
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
      }

      // --- debug layer ------------------------------------------------
      if (debugRef.current && f.rawLandmarks) {
        ctx.fillStyle = "rgba(255, 120, 80, 0.8)";
        for (const p of f.rawLandmarks) {
          const [x, y] = px(p);
          ctx.fillRect(x - dpr, y - dpr, 2 * dpr, 2 * dpr);
        }
        if (f.boundingBox) {
          const bb = f.boundingBox;
          const bx = offX + (mirror ? 1 - bb.x - bb.w : bb.x) * bwScale;
          ctx.strokeStyle = "rgba(255, 120, 80, 0.6)";
          ctx.lineWidth = dpr;
          ctx.strokeRect(bx, offY + bb.y * bhScale, bb.w * bwScale, bb.h * bhScale);
        }
        // orientation axes from pose
        if (f.pose) {
          const cx = w / 2;
          const cy = h * 0.88;
          const L = 40 * dpr;
          ctx.strokeStyle = "rgba(255, 200, 60, 0.8)";
          ctx.lineWidth = dpr;
          ctx.beginPath();
          ctx.moveTo(cx - L, cy);
          ctx.lineTo(cx + L, cy);
          ctx.moveTo(cx, cy - L);
          ctx.lineTo(cx, cy + L);
          ctx.stroke();
        }
      }
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [frame, videoRef, scaffold]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      aria-hidden
    />
  );
}
