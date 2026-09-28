"use client";

import { useEffect, useRef, useState } from "react";
import {
  projectTurntable,
  projectParallax,
  drawSignatureMesh,
  drawSilhouetteSweep,
} from "@/lib/visualization/meshRender";
import { extractEdges } from "@/lib/visualization/edgeExtract";
import { regionBounds, type SourceRect } from "@/lib/vision/imageTransform";
import type { Landmark } from "@/types/vision";

/**
 * Visual Signature hero — the merged multi-view canonical point cloud
 * rendered on a slow turntable (±38° yaw, gentle pitch drift).
 *
 * Layers (back → front):
 *   1. captured-frame reference — faint, blurred
 *   2. edge reference — Sobel lines extracted once from the capture
 *      (glasses rims, brows, hairline, jaw) at low opacity
 *   3. facial geometry — region-weighted canonical cloud (dominant)
 *
 * The photo and its edge map share one coordinate space; both are
 * stretched onto the projected landmark bbox each frame — same indices,
 * same transform, one registered face.
 */
export interface SignatureReference {
  image: string;
  landmarks: readonly Landmark[];
  crop: SourceRect;
  mirrored: boolean;
}

// holographic parallax turntable (V6.6) — the face stays frontal; the
// keyframes drive parallax INTENSITY, not physical yaw. Monocular
// depth is only confident near-frontal, so identity anchors never
// deform and the hero is front-facing most of the loop.
// Keyframes: [ms, turn] where turn ∈ [-1, 1].
const ORBIT_KEYS: readonly (readonly [number, number])[] = [
  [0, 0],
  [900, 0],      // front hero
  [1550, 1],     // → parallax right
  [1750, 1],     // brief hold
  [2450, 0],     // → front
  [3100, -1],    // → parallax left
  [3300, -1],    // brief hold
  [4000, 0],     // → front
  [5200, 0],     // long hero hold
];
const ORBIT_PERIOD = ORBIT_KEYS[ORBIT_KEYS.length - 1][0];

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** eased turn value ∈ [-1,1] at time t (ms) — loops the envelope */
function turntableTurn(t: number): number {
  const tt = t % ORBIT_PERIOD;
  for (let i = 0; i < ORBIT_KEYS.length - 1; i++) {
    const [t0, a0] = ORBIT_KEYS[i];
    const [t1, a1] = ORBIT_KEYS[i + 1];
    if (tt >= t0 && tt <= t1) {
      return a0 + (a1 - a0) * smoothstep(t0, t1, tt);
    }
  }
  return 0;
}

/**
 * Parallax confidence tiers — |turn| ≤ 0.5 full detail, ≤ 0.8 mild
 * interior reduction, ≤ 1.0 IDENTITY LOCK (silhouette/features full,
 * interior thin). Used only for presentation.
 */
function viewConfidence(turn: number): number {
  const a = Math.abs(turn);
  if (a <= 0.5) return 1;
  if (a <= 0.8) return 1 - 0.15 * smoothstep(0.5, 0.8, a);
  return 0.85 - 0.1 * smoothstep(0.8, 1, a);
}

export default function SignatureMesh({
  points,
  reference,
  size = 260,
  fun = false,
  debug = false,
}: {
  points: Float32Array | null;
  reference?: SignatureReference | null;
  size?: number;
  fun?: boolean;
  debug?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const debugRef = useRef<HTMLCanvasElement>(null);
  const ptsRef = useRef(points);
  const refImgRef = useRef<HTMLImageElement | null>(null);
  const edgeRef = useRef<HTMLCanvasElement | null>(null);
  const refSrcRef = useRef<SourceRect | null>(null);
  const [refLoaded, setRefLoaded] = useState(0);
  const debugLive = useRef(debug);
  const hasRef = !!reference;

  useEffect(() => {
    debugLive.current = debug;
  }, [debug]);

  useEffect(() => {
    ptsRef.current = points;
  }, [points]);

  useEffect(() => {
    refImgRef.current = null;
    edgeRef.current = null;
    refSrcRef.current = null;
    if (!reference) return;
    // landmark bbox in the captured image's pixel space — same transform
    // family as every other consumer (region-space mirror included)
    const nb = regionBounds(reference.landmarks, reference.crop, reference.mirrored);
    const img = new Image();
    img.onload = () => {
      refImgRef.current = img;
      edgeRef.current = extractEdges(img); // once per capture, cached
      refSrcRef.current = nb
        ? {
            x: nb.x * img.width,
            y: nb.y * img.height,
            w: nb.w * img.width,
            h: nb.h * img.height,
          }
        : null;
      // async callback — re-triggers the debug layer strip
      setRefLoaded((v) => v + 1);
    };
    img.src = reference.image;
  }, [reference]);

  // DEBUG-only layer strip: CAPTURE / EDGES / GEOMETRY side by side so
  // registration and edge quality can be inspected per layer
  useEffect(() => {
    const strip = debugRef.current;
    if (!debug || !strip) return;
    const ctx = strip.getContext("2d");
    if (!ctx) return;
    const img = refImgRef.current;
    const edge = edgeRef.current;
    const pts = ptsRef.current;
    if (!img || !pts) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cell = 92;
    const W = cell * 3 + 16;
    strip.width = W * dpr;
    strip.height = (cell + 14) * dpr;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#0b0d0e";
    ctx.fillRect(0, 0, W, cell + 14);
    ctx.font = "7px monospace";
    ctx.textAlign = "center";

    const src = refSrcRef.current;
    const sx = src && img.width ? src.x : 0;
    const sy = src && img.height ? src.y : 0;
    const sw = src ? src.w : img.width;
    const sh = src ? src.h : img.height;

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cell, cell);
    ctx.fillStyle = "#8a94a0";
    ctx.fillText("CAPTURE", cell / 2, cell + 9);

    if (edge) {
      const k = edge.width / img.width;
      ctx.drawImage(
        edge,
        sx * k, sy * k, sw * k, sh * k,
        cell + 8, 0, cell, cell,
      );
    }
    ctx.fillText("EDGES", cell + 8 + cell / 2, cell + 9);

    // geometry alone — frontal projection of the canonical cloud
    const g3 = cell * 2 + 16;
    const proj = projectTurntable(pts, 0, 0, g3 + cell / 2, cell / 2, cell * 0.45);
    drawSignatureMesh(ctx, proj, 1);
    ctx.fillStyle = "#8a94a0";
    ctx.fillText("GEOMETRY", g3 + cell / 2, cell + 9);
  }, [debug, hasRef, reference, points, refLoaded]);

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
    const R = canvas.width * 0.64; // hero scale — reconstruction is dominant

    let raf = 0;
    const t0 = performance.now();
    const render = () => {
      raf = requestAnimationFrame(render);
      const pts = ptsRef.current;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!pts || pts.length === 0) return;
      const t = (performance.now() - t0) / 1000;
      const turn = turntableTurn(t * 1000);
      const conf = viewConfidence(turn);
      const proj = projectParallax(pts, turn, cx, cy, R);

      // registered media layers — projected landmark bbox each frame
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
        const edge = edgeRef.current;

        // 1. captured frame — faintest contextual layer
        ctx.save();
        ctx.globalAlpha = 0.08;
        ctx.filter = "blur(2px)";
        ctx.drawImage(
          img,
          src.x - sx, src.y - sy, src.w + sx * 2, src.h + sy * 2,
          minX - mx, minY - my, dw + mx * 2, dh + my * 2,
        );
        // 2. identity edge map — clipped to the face ellipse so
        // background edges never compete with facial structure
        if (edge) {
          const k = edge.width / img.width;
          ctx.filter = "none";
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(
            minX + dw / 2,
            minY + dh / 2,
            (dw / 2) * 1.15,
            (dh / 2) * 1.15,
            0,
            0,
            Math.PI * 2,
          );
          ctx.clip();
          ctx.globalAlpha = 0.24 * conf;
          ctx.drawImage(
            edge,
            (src.x - sx) * k, (src.y - sy) * k,
            (src.w + sx * 2) * k, (src.h + sy * 2) * k,
            minX - mx, minY - my, dw + mx * 2, dh + my * 2,
          );
          ctx.restore();
        }
        ctx.restore();
      }

      // 3. facial geometry — dominant layer; interior thins at grazing
      // angles (view confidence), in FUN feature contours sweep-brighter
      drawSignatureMesh(
        ctx,
        proj,
        dpr,
        fun ? (Math.sin(t * 1.9) + 1) / 2 : 0,
        conf,
      );
      // FUN — silhouette highlight sweep + pulse ring + sparse particles
      if (fun) {
        drawSilhouetteSweep(ctx, proj, dpr, (t * 0.18) % 1);
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

      // DEBUG — live orbit diagnostics (development only)
      if (debugLive.current) {
        ctx.fillStyle = "rgba(255, 120, 80, 0.85)";
        ctx.font = `${8 * dpr}px monospace`;
        ctx.textAlign = "left";
        ctx.fillText(
          `PARALLAX ${turn.toFixed(2)}  CONF ${conf.toFixed(2)}  ${
            conf < 0.9 ? "IDENTITY LOCK" : "FULL DETAIL"
          }`,
          6 * dpr,
          12 * dpr,
        );
      }
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [size, fun, hasRef]);

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size }}
        aria-hidden
      />
      {debug && hasRef && (
        <canvas
          ref={debugRef}
          className="mt-2"
          style={{ width: 3 * 92 + 16, height: 106 }}
        />
      )}
    </div>
  );
}
