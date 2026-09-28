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

const REGION_IDX = {
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

function centroid(lm: Landmark[]): [number, number] {
  let x = 0, y = 0;
  for (const p of lm) {
    x += p.x;
    y += p.y;
  }
  return [x / lm.length, y / lm.length];
}

/**
 * Normalized displacement vector between two landmark fields (both in
 * normalized landmark space).
 *
 * Two biases are removed before scoring so a completed challenge does
 * not auto-saturate:
 *   1. whole-head translation — centroids are aligned so pure drift
 *      produces zero regional motion (rotation still registers)
 *   2. ambient floor — the median per-landmark displacement (residual
 *      rigid/tracking noise shared across the face) is discounted from
 *      every region, so bars reflect motion ABOVE background
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

  // remove whole-head translation
  const [bx, by] = centroid(baseline);
  const [cx, cy] = centroid(current);
  const tx = cx - bx;
  const ty = cy - by;

  const dispAt = (i: number) => {
    const a = baseline[i];
    const b = current[i];
    return Math.hypot(b.x - tx - a.x, b.y - ty - a.y);
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
