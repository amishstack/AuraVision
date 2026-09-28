import type { Landmark } from "@/types/vision";

/**
 * Geometric symmetry — reflects the landmark cloud about the face's
 * vertical axis and measures per-landmark deviation from the nearest
 * mirrored point. Descriptive geometry only; asymmetry ≠ defect.
 */

export interface SymmetryResult {
  /** 0..100 — higher = more symmetric. */
  score: number;
  /** per-landmark deviation normalized 0..1 (for the symmetry field). */
  field: Float32Array;
  /** x-position of the best-fit symmetry axis (normalized coords). */
  axisX: number;
}

export function computeSymmetry(lm: Landmark[]): SymmetryResult | null {
  const n = lm.length;
  if (n === 0) return null;

  // Symmetry axis ≈ mean x of midline-ish landmarks (nose bridge area).
  // Use the full cloud mean for robustness.
  let cx = 0;
  for (const p of lm) cx += p.x;
  cx /= n;

  // Face width for normalization (x-extent of the cloud).
  let minX = Infinity, maxX = -Infinity;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  const faceW = Math.max(maxX - minX, 1e-5);

  // For each landmark, distance to nearest point of the mirrored cloud.
  // Build a coarse spatial hash of mirrored points for speed.
  const mirror = new Array<{ x: number; y: number }>(n);
  for (let i = 0; i < n; i++) {
    mirror[i] = { x: 2 * cx - lm[i].x, y: lm[i].y };
  }

  const field = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    const mx = mirror[i].x, my = mirror[i].y;
    for (let j = 0; j < n; j++) {
      const dx = lm[j].x - mx;
      const dy = lm[j].y - my;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    const dev = Math.sqrt(best) / faceW; // normalized by face width
    field[i] = dev;
    sum += dev;
  }

  const meanDev = sum / n;
  // Empirical scale: mean deviation ~0.02 of face width ≈ symmetric.
  const score = Math.max(0, Math.min(100, Math.round(100 - meanDev * 900)));

  // Scale field to 0..1 for visualization (cap at ~0.08 deviation).
  for (let i = 0; i < n; i++) field[i] = Math.min(field[i] / 0.08, 1);

  return { score, field, axisX: cx };
}
