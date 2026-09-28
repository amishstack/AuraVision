"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { MESH, sparseScaffold } from "@/lib/geometry/mesh";
import { regionMapper } from "@/lib/vision/imageTransform";
import type { TrackingFrame } from "@/types/vision";

/**
 * Camera ⇄ Geometry comparison slider — draws the live video cropped to
 * the face region, then the live landmark geometry on top. Slider blends
 * between the two. Hero interactive for Deep Analysis results.
 */

const ACCENT = "140, 210, 240";
const WHITE = "225, 232, 240";

export default function CameraGeometryBlend({
  frame,
  videoRef,
  size = 220,
}: {
  frame: MutableRefObject<TrackingFrame>;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [blend, setBlend] = useState(0.5);
  const blendRef = useRef(blend);
  const scaffold = useMemo(() => sparseScaffold(5), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const W = canvas.width, H = canvas.height;

    let raf = 0;
    const render = () => {
      raf = requestAnimationFrame(render);
      const f = frame.current;
      const video = videoRef.current;
      const t = blendRef.current;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);

      if (!video || video.readyState < 2 || !f.boundingBox || !f.landmarks) return;

      const bb = f.boundingBox;
      // face region expanded ×1.5, clamped to frame
      const ex = bb.x - bb.w * 0.22, ey = bb.y - bb.h * 0.28;
      const ew = bb.w * 1.44, eh = bb.h * 1.56;
      const sx = Math.max(0, ex), sy = Math.max(0, ey);
      const sw = Math.min(1, ex + ew) - sx, sh = Math.min(1, ey + eh) - sy;
      const vw = video.videoWidth, vh = video.videoHeight;

      // camera layer (alpha = 1-t)
      const camA = 1 - t;
      if (camA > 0.01) {
        ctx.save();
        ctx.globalAlpha = camA;
        if (f.mirrored) {
          ctx.translate(W, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(
          video,
          sx * vw, sy * vh, sw * vw, sh * vh,
          0, 0, W, H,
        );
        ctx.restore();
      }

      // geometry layer (alpha = t)
      const gA = t;
      if (gA > 0.01) {
        // canonical registration — mirror within the drawn sub-rect,
        // matching the flipped drawImage above
        const px = regionMapper(
          { x: sx, y: sy, w: sw, h: sh },
          W,
          H,
          f.mirrored,
        );
        ctx.save();
        ctx.globalAlpha = gA;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        const lm = f.landmarks;

        const edges = (set: readonly { start: number; end: number }[], c: string, a: number, wd: number) => {
          ctx.strokeStyle = `rgba(${c}, ${a})`;
          ctx.lineWidth = wd * dpr;
          ctx.beginPath();
          for (const e of set) {
            const A = lm[e.start], B = lm[e.end];
            if (!A || !B) continue;
            const [ax, ay] = px(A);
            const [bx, by] = px(B);
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
          }
          ctx.stroke();
        };
        edges(scaffold, ACCENT, 0.15, 0.6);
        edges(MESH.contours, ACCENT, 0.25, 0.8);
        edges(MESH.faceOval, WHITE, 0.7, 1.1);
        edges(MESH.leftEye, WHITE, 0.55, 0.9);
        edges(MESH.rightEye, WHITE, 0.55, 0.9);
        edges(MESH.lips, WHITE, 0.55, 0.9);
        ctx.restore();
      }
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [frame, videoRef, scaffold, size]);

  return (
    <div className="flex flex-col items-center gap-2">
      <canvas ref={canvasRef} style={{ width: size, height: size }} />
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(blend * 100)}
        onChange={(e) => {
          const v = Number(e.target.value) / 100;
          setBlend(v);
          blendRef.current = v;
        }}
        className="w-40 accent-neutral-400"
        aria-label="Camera to geometry blend"
      />
      <div className="flex w-40 justify-between font-mono text-[8px] tracking-[0.2em] text-neutral-600">
        <span>CAMERA</span>
        <span>GEOMETRY</span>
      </div>
    </div>
  );
}
