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

// ~6% of face height of mean regional displacement saturates the region —
// a strong expression moves feature landmarks well past this.
const SATURATION = 0.06;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function regionDisplacement(
  base: Landmark[],
  cur: Landmark[],
  idx: readonly number[],
  scale: number,
): number {
  let sum = 0;
  let n = 0;
  for (const i of idx) {
    const a = base[i];
    const b = cur[i];
    if (!a || !b) continue;
    sum += Math.hypot(b.x - a.x, b.y - a.y);
    n++;
  }
  return n ? clamp01(sum / n / (scale * SATURATION)) : 0;
}

/**
 * Normalized displacement vector between two landmark fields (both in
 * normalized landmark space). Region weights: features dominate the
 * overall score; silhouette/jaw are context.
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

  const v: Record<ExpressionRegion, number> = {
    brow: regionDisplacement(baseline, current, REGION_IDX.brow, scale),
    eyes: regionDisplacement(baseline, current, REGION_IDX.eyes, scale),
    nose: regionDisplacement(baseline, current, REGION_IDX.nose, scale),
    mouth: regionDisplacement(baseline, current, REGION_IDX.mouth, scale),
    cheeks: regionDisplacement(baseline, current, REGION_IDX.cheeks, scale),
    jaw: regionDisplacement(baseline, current, REGION_IDX.jaw, scale),
    silhouette: regionDisplacement(baseline, current, REGION_IDX.silhouette, scale),
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
