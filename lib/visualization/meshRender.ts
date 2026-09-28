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

// ---------------------------------------------------------------------------
// Identity-preserving parallax (V6.6)
//
// MediaPipe z is relative facial-surface depth — NOT a volumetric head
// scan. Rigidly rotating the cloud past ~±10° produces a malformed side
// profile. Instead the hero stays frontal and turn is expressed as
// bounded screen-space parallax: interior/mid-face structure (nose,
// cheeks) displaces with depth while identity anchors (eyes, jaw,
// silhouette) barely move. The hologram turns; the face never breaks.
// ---------------------------------------------------------------------------

let plxCache: Float32Array | null = null;

/** Per-landmark parallax weight: identity anchors ~0.35, interior 1.0. */
function parallaxWeights(): Float32Array {
  if (plxCache) return plxCache;
  const w = new Float32Array(478).fill(1.0);
  const pin = (idx: number, v: number) => {
    if (idx < w.length) w[idx] = Math.min(w[idx], v);
  };
  // identity anchors — silhouette, eyes, iris: near-locked
  for (const set of [MESH.faceOval, MESH.leftEye, MESH.rightEye, MESH.leftIris, MESH.rightIris]) {
    for (const e of set) {
      pin(e.start, 0.35);
      pin(e.end, 0.35);
    }
  }
  // lips + brows — mostly anchored
  for (const set of [MESH.lips, MESH.leftBrow, MESH.rightBrow]) {
    for (const e of set) {
      pin(e.start, 0.65);
      pin(e.end, 0.65);
    }
  }
  // nose ridge/base — strongest parallax (it's the nearest structure)
  for (const idx of NOSE_RIDGE) w[idx] = 1.0;
  for (const idx of NOSE_BASE) w[idx] = 1.0;
  plxCache = w;
  return w;
}

/**
 * Parallax projection — `turn` ∈ [-1, 1] drives bounded lateral offset:
 * nearer (lower z) interior landmarks shift further; anchored features
 * stay put. A subtle horizontal squash sells the turn without ever
 * forming a profile.
 */
export function projectParallax(
  pts: Float32Array,
  turn: number,
  cx: number,
  cy: number,
  radius: number,
): Projection {
  const plx = parallaxWeights();
  const n = pts.length / 3;
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const sz = new Float32Array(n);
  const squash = 1 - 0.06 * Math.abs(turn);
  const K = 0.38; // max depth-displacement gain — bounded by design
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
    // nearer structure (negative z convention: nose < edges) shifts most
    const depthN = Math.max(-1, Math.min(1, -z * 3)); // nose-forward → +1
    sx[i] = cx + (x * squash - depthN * plx[i] * turn * K) * radius;
    sy[i] = cy + y * radius * (1 - 0.03 * Math.abs(turn));
    sz[i] = z;
  }
  return { sx, sy, sz, n };
}

// ---------------------------------------------------------------------------
// Facial-region presentation weights
//
// Humans recognize a face from its high-structure regions — silhouette,
// eyes, brows, nose, mouth, jaw. Interior planar areas carry less identity,
// so they render fainter. Weights affect ONLY rendering (edge alpha, node
// size, depth modulation); the underlying landmark coordinates are
// untouched and the canonical cloud stays the subject's real geometry.
// ---------------------------------------------------------------------------

/** Nose structure — real MediaPipe indices: bridge ridge + base/nostril bar. */
const NOSE_RIDGE = [168, 6, 197, 195, 5, 4, 1, 19, 94, 2] as const;
const NOSE_BASE = [98, 97, 2, 327, 326] as const;

let weightCache: Float32Array | null = null;

/** Per-landmark presentation weight: 0.35 flat interior → 1.0 key structure. */
function regionWeights(): Float32Array {
  if (weightCache) return weightCache;
  const w = new Float32Array(478).fill(0.35);
  const raise = (idx: number, v: number) => {
    if (idx < w.length && v > w[idx]) w[idx] = v;
  };
  // medium — secondary contours (cheek topology, nose-adjacent paths)
  for (const e of MESH.contours) {
    raise(e.start, 0.6);
    raise(e.end, 0.6);
  }
  // high — the regions that carry recognizable structure
  for (const set of [
    MESH.faceOval,
    MESH.leftEye,
    MESH.rightEye,
    MESH.leftBrow,
    MESH.rightBrow,
    MESH.lips,
    MESH.leftIris,
    MESH.rightIris,
  ]) {
    for (const e of set) {
      raise(e.start, 1);
      raise(e.end, 1);
    }
  }
  for (const idx of NOSE_RIDGE) raise(idx, 0.95);
  for (const idx of NOSE_BASE) raise(idx, 0.95);
  weightCache = w;
  return w;
}

function drawEdges(
  ctx: CanvasRenderingContext2D,
  proj: Projection,
  set: readonly { start: number; end: number }[],
  col: string,
  a: number,
  wdt: number,
): void {
  const { sx, sy, n } = proj;
  ctx.strokeStyle = `rgba(${col}, ${a})`;
  ctx.lineWidth = wdt;
  ctx.beginPath();
  for (const e of set) {
    if (e.start >= n || e.end >= n) continue;
    ctx.moveTo(sx[e.start], sy[e.start]);
    ctx.lineTo(sx[e.end], sy[e.end]);
  }
  ctx.stroke();
}

function drawPolyline(
  ctx: CanvasRenderingContext2D,
  proj: Projection,
  idx: readonly number[],
  col: string,
  a: number,
  wdt: number,
): void {
  const { sx, sy, n } = proj;
  ctx.strokeStyle = `rgba(${col}, ${a})`;
  ctx.lineWidth = wdt;
  ctx.beginPath();
  let started = false;
  for (const i of idx) {
    if (i >= n) continue;
    if (!started) {
      ctx.moveTo(sx[i], sy[i]);
      started = true;
    } else {
      ctx.lineTo(sx[i], sy[i]);
    }
  }
  ctx.stroke();
}

export function drawSignatureMesh(
  ctx: CanvasRenderingContext2D,
  proj: Projection,
  dpr: number,
  /** optional 0..1 glow — FUN mode sweeps feature brightness with it */
  glow = 0,
  /**
   * view confidence 0..1 — monocular reconstruction is only reliable
   * near frontal. Low confidence fades the interior scaffold/nodes;
   * silhouette, features and nose stay at full strength.
   */
  conf = 1,
): void {
  const { sx, sy, sz, n } = proj;
  const w = regionWeights();
  const scaffold = sparseScaffold(8);
  const featBoost = 1 + glow * 0.5;
  // interior detail thins as confidence drops — never the structure
  const inner = 0.45 + 0.55 * conf;

  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // interior scaffold — faint structural web, thinner at lower confidence
  drawEdges(ctx, proj, scaffold, ACCENT, 0.09 * inner, dpr * 0.7);

  // secondary contours — medium topology (cheeks, nose-adjacent paths)
  drawEdges(ctx, proj, MESH.contours, ACCENT, 0.22 * inner, dpr * 0.8);

  // nose structure — strongest mid-face cue, kept readable while orbiting
  drawPolyline(ctx, proj, NOSE_RIDGE, WHITE, 0.62 * featBoost, dpr * 1.0);
  drawPolyline(ctx, proj, NOSE_BASE, WHITE, 0.5 * featBoost, dpr * 0.9);

  // features — eyes, brows, iris, lips
  drawEdges(ctx, proj, MESH.leftBrow, WHITE, 0.6 * featBoost, dpr * 0.95);
  drawEdges(ctx, proj, MESH.rightBrow, WHITE, 0.6 * featBoost, dpr * 0.95);
  drawEdges(ctx, proj, MESH.leftEye, WHITE, 0.68 * featBoost, dpr * 0.95);
  drawEdges(ctx, proj, MESH.rightEye, WHITE, 0.68 * featBoost, dpr * 0.95);
  drawEdges(ctx, proj, MESH.leftIris, ACCENT, 0.5 * featBoost, dpr * 0.85);
  drawEdges(ctx, proj, MESH.rightIris, ACCENT, 0.5 * featBoost, dpr * 0.85);
  drawEdges(ctx, proj, MESH.lips, WHITE, 0.7 * featBoost, dpr * 1.0);

  // silhouette — the actual landmark face oval: jaw, chin, temples.
  // Two passes: a wide faint glow under a crisp primary contour.
  // Brightens slightly as interior detail thins ("holographic lock").
  const lockGlow = 1 + (1 - conf) * 0.2;
  drawEdges(ctx, proj, MESH.faceOval, WHITE, 0.16, dpr * 3.2);
  drawEdges(ctx, proj, MESH.faceOval, WHITE, Math.min(0.92, 0.78 * lockGlow), dpr * 1.3);

  // nodes — weighted by facial region; depth (relative z) modulates both
  // brightness and size so nearer structure reads forward. Interior
  // (low-weight) nodes fade first at grazing view angles.
  for (let i = 0; i < n; i++) {
    const rel = Math.max(0, Math.min(1, sz[i] * 0.5 + 0.5));
    const wi = w[i];
    const depthA = wi >= 1 ? 1 : inner; // structure nodes stay bright
    const a = wi * (0.10 + 0.5 * rel) * 0.9 * depthA;
    const s = dpr * (0.5 + 0.9 * wi) * (0.75 + 0.5 * rel);
    ctx.fillStyle = `rgba(${ACCENT}, ${a})`;
    ctx.fillRect(sx[i] - s / 2, sy[i] - s / 2, s, s);
  }
}

/**
 * FUN — a bright segment that travels along the silhouette contour.
 * Presentation only; the geometry is untouched.
 */
export function drawSilhouetteSweep(
  ctx: CanvasRenderingContext2D,
  proj: Projection,
  dpr: number,
  phase: number, // 0..1 along the oval
): void {
  const { sx, sy, n } = proj;
  const oval = MESH.faceOval;
  const L = oval.length;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (let i = 0; i < L; i++) {
    const e = oval[i];
    if (e.start >= n || e.end >= n) continue;
    // distance from the sweep window, wrapping around the loop
    let d = Math.abs(i / L - phase);
    if (d > 0.5) d = 1 - d;
    const a = Math.exp(-d * d * 90) * 0.5;
    if (a < 0.02) continue;
    ctx.strokeStyle = `rgba(${ACCENT}, ${a})`;
    ctx.lineWidth = dpr * 1.3;
    ctx.beginPath();
    ctx.moveTo(sx[e.start], sy[e.start]);
    ctx.lineTo(sx[e.end], sy[e.end]);
    ctx.stroke();
  }
}
