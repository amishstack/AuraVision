"use client";

import { useEffect, useRef } from "react";
import { projectTurntable, drawSignatureMesh } from "@/lib/visualization/meshRender";
import { regionBounds, type SourceRect } from "@/lib/vision/imageTransform";
import type { Landmark } from "@/types/vision";

/**
 * Visual Signature hero — the merged multi-view canonical point cloud
 * rendered on a slow turntable (±38° yaw, gentle pitch drift).
 *
 * When `reference` is provided, the captured frame is drawn inside the
 * same canvas, registered to the projection: the landmark bounding box
 * of the captured image is stretched onto the projected landmark
 * bounding box — same indices, same coordinate frame, one face.
 */
export interface SignatureReference {
  image: string;
  landmarks: readonly Landmark[];
  crop: SourceRect;
  mirrored: boolean;
}

export default function SignatureMesh({
  points,
  reference,
  size = 260,
  fun = false,
}: {
  points: Float32Array | null;
  reference?: SignatureReference | null;
  size?: number;
  fun?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ptsRef = useRef(points);
  const refImgRef = useRef<HTMLImageElement | null>(null);
  const refSrcRef = useRef<SourceRect | null>(null);
  const hasRef = !!reference;

  useEffect(() => {
    ptsRef.current = points;
  }, [points]);

  useEffect(() => {
    refImgRef.current = null;
    refSrcRef.current = null;
    if (!reference) return;
    // landmark bbox in the captured image's pixel space — same transform
    // family as every other consumer (region-space mirror included)
    const nb = regionBounds(reference.landmarks, reference.crop, reference.mirrored);
    const img = new Image();
    img.onload = () => {
      refImgRef.current = img;
      refSrcRef.current = nb
        ? {
            x: nb.x * img.width,
            y: nb.y * img.height,
            w: nb.w * img.width,
            h: nb.h * img.height,
          }
        : null;
    };
    img.src = reference.image;
  }, [reference]);

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
    const R = canvas.width * 0.45;

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
        fun
          ? Math.sin(t * 0.85) * 0.78 // livelier ±~45° orbit in FUN
          : Math.sin(t * 0.55) * 0.66,
        fun ? Math.sin(t * 0.31) * 0.14 : Math.sin(t * 0.22) * 0.10,
        cx,
        cy,
        R,
      );

      // captured-frame reference — registered to the projected landmark
      // bbox each frame so the silhouette and mesh describe one position
      const img = refImgRef.current;
      const src = refSrcRef.current;
      if (img && src && src.w > 0 && src.h > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < proj.n; i++) {
          if (proj.sx[i] < minX) minX = proj.sx[i];
          if (proj.sx[i] > maxX) maxX = proj.sx[i];
          if (proj.sy[i] < minY) minY = proj.sy[i];
          if (proj.sy[i] > maxY) maxY = proj.sy[i];
        }
        // ~8% margin so accessories (e.g. glasses rims) beyond the strict
        // landmark bounds remain faintly visible behind the geometry —
        // margin scaled into the source image's own pixel space
        const dw = maxX - minX;
        const dh = maxY - minY;
        const mx = dw * 0.08;
        const my = dh * 0.08;
        const sx = mx * (src.w / dw);
        const sy = my * (src.h / dh);
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.filter = "blur(2px)";
        ctx.drawImage(
          img,
          src.x - sx, src.y - sy, src.w + sx * 2, src.h + sy * 2,
          minX - mx, minY - my, dw + mx * 2, dh + my * 2,
        );
        ctx.restore();
      }

      drawSignatureMesh(ctx, proj, dpr);
      // FUN pulse — brief glow ring on each orbit beat + sparse drifting
      // particles around the reconstruction
      if (fun) {
        const beat = (Math.sin(t * 1.7) + 1) / 2;
        ctx.strokeStyle = `rgba(140,210,240,${0.05 + beat * 0.08})`;
        ctx.lineWidth = dpr;
        ctx.beginPath();
        ctx.arc(cx, cy, R * (0.72 + beat * 0.06), 0, Math.PI * 2);
        ctx.stroke();
        for (let i = 0; i < 14; i++) {
          const ang = t * 0.25 + i * 0.449;
          const rr = R * (0.62 + 0.3 * Math.sin(i * 2.1 + t * 0.4));
          const x = cx + Math.cos(ang) * rr;
          const y = cy + Math.sin(ang) * rr;
          ctx.fillStyle = `rgba(140,210,240,${0.10 + 0.08 * Math.sin(t + i)})`;
          ctx.fillRect(x, y, dpr, dpr);
        }
      }
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [size, fun, hasRef]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}
