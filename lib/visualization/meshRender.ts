import { MESH, sparseScaffold } from "@/lib/geometry/mesh";

/**
 * Shared turntable projection + draw for the canonical signature cloud.
 * Used by SignatureMesh (live turntable) and the share artifact
 * (static render).
 */

const ACCENT = "140, 210, 240";
const WHITE = "225, 232, 240";

export interface Projection {
  sx: Float32Array;
  sy: Float32Array;
  sz: Float32Array;
  n: number;
}

export function projectTurntable(
  pts: Float32Array,
  yaw: number,
  pitch: number,
  cx: number,
  cy: number,
  radius: number,
): Projection {
  const cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const n = pts.length / 3;
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const sz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
    const x1 = cyw * x + syw * z;
    const z1 = -syw * x + cyw * z;
    const y2 = cp * y - sp * z1;
    const z2 = sp * y + cp * z1;
    sx[i] = cx + x1 * radius;
    sy[i] = cy + y2 * radius;
    sz[i] = z2;
  }
  return { sx, sy, sz, n };
}

export function drawSignatureMesh(
  ctx: CanvasRenderingContext2D,
  proj: Projection,
  dpr: number,
): void {
  const { sx, sy, sz, n } = proj;
  const scaffold = sparseScaffold(8);

  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // sparse scaffold
  ctx.strokeStyle = `rgba(${ACCENT}, 0.14)`;
  ctx.lineWidth = dpr * 0.7;
  ctx.beginPath();
  for (const e of scaffold) {
    if (e.start >= n || e.end >= n) continue;
    ctx.moveTo(sx[e.start], sy[e.start]);
    ctx.lineTo(sx[e.end], sy[e.end]);
  }
  ctx.stroke();

  // silhouette + features
  ctx.strokeStyle = `rgba(${WHITE}, 0.5)`;
  ctx.lineWidth = dpr;
  ctx.beginPath();
  for (const set of [MESH.faceOval, MESH.leftEye, MESH.rightEye, MESH.lips]) {
    for (const e of set) {
      if (e.start >= n || e.end >= n) continue;
      ctx.moveTo(sx[e.start], sy[e.start]);
      ctx.lineTo(sx[e.end], sy[e.end]);
    }
  }
  ctx.stroke();

  // nodes — near points brighter (depth cue)
  for (let i = 0; i < n; i++) {
    const rel = Math.max(0, Math.min(1, sz[i] * 0.5 + 0.5));
    ctx.fillStyle = `rgba(${ACCENT}, ${0.15 + 0.45 * rel})`;
    ctx.fillRect(sx[i] - dpr * 0.75, sy[i] - dpr * 0.75, dpr * 1.5, dpr * 1.5);
  }
}
