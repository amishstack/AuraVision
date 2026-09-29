import type { ExpressionVector, Landmark } from "@/types/vision";
import { MESH } from "@/lib/geometry/mesh";

/**
 * Expression vector — per-region geometric displacement between a frozen
 * neutral baseline and the current landmark field. Displacement is
 * normalized by face height so values are stable across camera distance.
 *
 * This measures GEOMETRIC CHANGE only. It is not emotion detection and
 * makes no claims about the subject.
 */

// --- region landmark sets ---------------------------------------------------

function uniqueIdx(sets: readonly { start: number; end: number }[][]): number[] {
  const s = new Set<number>();
  for (const set of sets) for (const e of set) {
    s.add(e.start);
    s.add(e.end);
  }
  return [...s];
}

export const REGION_IDX = {
  brow: uniqueIdx([MESH.leftBrow, MESH.rightBrow]),
  eyes: uniqueIdx([MESH.leftEye, MESH.rightEye, MESH.leftIris, MESH.rightIris]),
  nose: [168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 98, 97, 326, 327],
  mouth: uniqueIdx([MESH.lips]),
  cheeks: [50, 101, 118, 119, 100, 36, 205, 207, 280, 330, 347, 348, 329, 266, 425, 427],
  jaw: [172, 136, 150, 149, 176, 148, 377, 400, 378, 379, 365, 397],
  silhouette: uniqueIdx([MESH.faceOval]),
} as const;

export type ExpressionRegion = keyof typeof REGION_IDX;

export const REGION_ORDER: ExpressionRegion[] = [
  "brow",
  "eyes",
  "nose",
  "mouth",
  "cheeks",
  "jaw",
  "silhouette",
];

const FOREHEAD = 10;
const CHIN = 152;

// A region saturates when its deformation (above ambient head motion)
// reaches ~12% of face height — an exaggerated expression. Ordinary
// successful movements land at 20–80%, not 100.
const SATURATION = 0.12;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Pose normalization (V7.5): the measured signal must be facial
 * DEFORMATION, not rigid head motion. A 2D similarity transform
 * (translate + rotate + uniform scale) is fit between baseline and
 * current over stable structural anchors; displacement is measured on
 * the aligned field. Head turning changes POSE, not FACIAL MOTION.
 * Non-rigid foreshortening from real rotation still registers honestly.
 */

// structurally stable anchors with reliability weights — eye corners
// and the nasal bridge barely deform; mouth corners and chin DO move
// during expressions, so they are down-weighted to keep the rigid fit
// honest during the motions we actually measure.
export const ALIGN_ANCHORS: readonly (readonly [number, number])[] = [
  [10, 0.8],   // forehead top
  [33, 1.0],   // L eye outer
  [133, 1.0],  // L eye inner
  [263, 1.0],  // R eye outer
  [362, 1.0],  // R eye inner
  [6, 1.0],    // nose bridge top
  [1, 1.0],    // nose bridge
  [4, 1.0],    // nose tip
  [61, 0.4],   // mouth corner L (deforms)
  [291, 0.4],  // mouth corner R (deforms)
  [152, 0.5],  // chin (jaw motion)
];

interface SimTransform {
  cos: number;
  sin: number;
  s: number; // uniform scale
  ax: number;
  ay: number; // source centroid (current)
  bx: number;
  by: number; // target centroid (baseline)
}

function fitOnce(
  base: Landmark[],
  cur: Landmark[],
  anchors: readonly (readonly [number, number])[],
): SimTransform | null {
  let ax = 0, ay = 0, bx = 0, by = 0, wsum = 0;
  for (const [i, w] of anchors) {
    const a = base[i];
    const b = cur[i];
    if (!a || !b) continue;
    bx += a.x * w;
    by += a.y * w;
    ax += b.x * w;
    ay += b.y * w;
    wsum += w;
  }
  if (wsum < 2) return null;
  ax /= wsum;
  ay /= wsum;
  bx /= wsum;
  by /= wsum;
  let num = 0, den = 0, sa = 0, sb = 0;
  for (const [i, w] of anchors) {
    const a = base[i];
    const b = cur[i];
    if (!a || !b) continue;
    const axp = a.x - bx, ayp = a.y - by;
    const bxp = b.x - ax, byp = b.y - ay;
    num += w * (ayp * bxp - axp * byp);
    den += w * (axp * bxp + ayp * byp);
    sa += w * Math.hypot(axp, ayp);
    sb += w * Math.hypot(bxp, byp);
  }
  if (sb < 1e-6) return null;
  const theta = Math.atan2(num, den);
  // scale absorbs camera-distance drift, clamped to sane bounds
  const s = Math.max(0.85, Math.min(1.2, sa / sb));
  return { cos: Math.cos(theta), sin: Math.sin(theta), s, ax, ay, bx, by };
}

function mapPt(t: SimTransform, p: { x: number; y: number }) {
  const dx = p.x - t.ax;
  const dy = p.y - t.ay;
  return {
    x: t.bx + t.s * (t.cos * dx - t.sin * dy),
    y: t.by + t.s * (t.sin * dx + t.cos * dy),
  };
}

/**
 * Weighted similarity fit with a single outlier-trim pass: anchors whose
 * residual exceeds 2.5× the median are dropped and the fit is redone.
 * This keeps a strong expression (which moves mouth/chin anchors) from
 * bending the rigid frame while removing true pose change.
 */
function fitSimilarity(base: Landmark[], cur: Landmark[]): SimTransform | null {
  let fit = fitOnce(base, cur, ALIGN_ANCHORS);
  if (!fit) return null;

  // residuals → trim worst anchors → refit once
  const res = ALIGN_ANCHORS.map(([i, w]) => {
    const a = base[i];
    const b = cur[i];
    if (!a || !b) return { i, w, r: 0 };
    const m = mapPt(fit!, b);
    return { i, w, r: Math.hypot(m.x - a.x, m.y - a.y) };
  }).sort((p, q) => p.r - q.r);
  const median = res[Math.floor(res.length / 2)]?.r ?? 0;
  const keep = res.filter((e) => e.r <= Math.max(1e-4, median * 2.5));
  if (keep.length >= 4 && keep.length < res.length) {
    fit =
      fitOnce(
        base,
        cur,
        keep.map((e) => [e.i, e.w] as const),
      ) ?? fit;
  }
  return fit;
}

function centroid(lm: Landmark[]): [number, number] {
  let x = 0, y = 0;
  for (const p of lm) {
    x += p.x;
    y += p.y;
  }
  return [x / lm.length, y / lm.length];
}

/**
 * Map `current` landmarks into baseline space via the anchor similarity
 * fit (translation + rotation + scale). Used by the motion-field
 * overlays so displayed vectors show pose-normalized deformation —
 * consistent with the measured values.
 */
export function alignLandmarks(
  baseline: Landmark[] | null,
  current: Landmark[] | null,
): Landmark[] | null {
  if (!baseline || !current || baseline.length < 400 || current.length < 400)
    return null;
  const fit = fitSimilarity(baseline, current);
  if (!fit) {
    const [bx, by] = centroid(baseline);
    const [cx, cy] = centroid(current);
    return current.map((p) => ({
      x: p.x - (cx - bx),
      y: p.y - (cy - by),
      z: p.z,
    }));
  }
  return current.map((p) => ({ ...mapPt(fit, p), z: p.z }));
}

/**
 * Normalized displacement vector between two landmark fields (both in
 * normalized landmark space).
 *
 * Two biases are removed before scoring so motion is measured honestly:
 *   1. rigid head motion — a similarity transform (translation +
 *      rotation + scale) aligned over stable anchors removes pose
 *      change, so only facial deformation counts
 *   2. ambient floor — the median per-landmark residual is discounted
 *      from every region, so bars reflect motion ABOVE tracking noise
 *
 * Region weights: features dominate the overall score; silhouette/jaw
 * are context.
 */
export function expressionVector(
  baseline: Landmark[] | null,
  current: Landmark[] | null,
): ExpressionVector | null {
  if (!baseline || !current || baseline.length < 400 || current.length < 400)
    return null;
  const scale = Math.hypot(
    baseline[FOREHEAD].x - baseline[CHIN].x,
    baseline[FOREHEAD].y - baseline[CHIN].y,
  );
  if (scale < 1e-5) return null;

  // similarity fit over anchors → residual deformation only
  const fit = fitSimilarity(baseline, current);
  let tx = 0, ty = 0;
  if (!fit) {
    // fallback: centroid translation only
    const [bx0, by0] = centroid(baseline);
    const [cx0, cy0] = centroid(current);
    tx = cx0 - bx0;
    ty = cy0 - by0;
  }

  const dispAt = (i: number) => {
    const a = baseline[i];
    const b = current[i];
    if (!a || !b) return 0;
    if (!fit) return Math.hypot(b.x - tx - a.x, b.y - ty - a.y);
    // map current point into baseline space: ca + s·R(θ)·(p − cb)
    const dx = b.x - fit.ax;
    const dy = b.y - fit.ay;
    const mx = fit.bx + fit.s * (fit.cos * dx - fit.sin * dy);
    const my = fit.by + fit.s * (fit.sin * dx + fit.cos * dy);
    return Math.hypot(mx - a.x, my - a.y);
  };

  // ambient floor — median displacement across a strided probe set
  const probes: number[] = [];
  for (let i = 0; i < baseline.length; i += 16) probes.push(dispAt(i));
  probes.sort((p, q) => p - q);
  const floor = probes[Math.floor(probes.length / 2)] ?? 0;

  const region = (idx: readonly number[]): number => {
    let sum = 0;
    let n = 0;
    for (const i of idx) {
      if (i < baseline.length) {
        sum += dispAt(i);
        n++;
      }
    }
    const mean = n ? sum / n : 0;
    // discount 60% of ambient motion; saturate at 12% of face height
    return clamp01(Math.max(0, mean - floor * 0.6) / (scale * SATURATION));
  };

  const v: Record<ExpressionRegion, number> = {
    brow: region(REGION_IDX.brow),
    eyes: region(REGION_IDX.eyes),
    nose: region(REGION_IDX.nose),
    mouth: region(REGION_IDX.mouth),
    cheeks: region(REGION_IDX.cheeks),
    jaw: region(REGION_IDX.jaw),
    silhouette: region(REGION_IDX.silhouette),
  };

  const overall =
    v.mouth * 0.24 +
    v.brow * 0.18 +
    v.eyes * 0.16 +
    v.cheeks * 0.14 +
    v.nose * 0.1 +
    v.jaw * 0.1 +
    v.silhouette * 0.08;

  return { ...v, overall: clamp01(overall) };
}

/** Element-wise max across captured vectors — the session's motion profile. */
export function aggregateVectors(list: ExpressionVector[]): ExpressionVector {
  const agg: ExpressionVector = {
    brow: 0, eyes: 0, nose: 0, mouth: 0, cheeks: 0, jaw: 0,
    silhouette: 0, overall: 0,
  };
  for (const v of list) {
    for (const k of REGION_ORDER) {
      const key = k as keyof ExpressionVector;
      if (v[key] > agg[key]) agg[key] = v[key];
    }
    if (v.overall > agg.overall) agg.overall = v.overall;
  }
  return agg;
}
