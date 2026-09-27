import type { DepthInfo, Landmark } from "@/types/vision";

/**
 * Relative facial depth.
 *
 * MediaPipe's landmark z-coordinate is a metric-relative estimate of each
 * point's distance along the camera axis (same units as x, origin near
 * the face center). It is NOT absolute depth — we normalize it into a
 * 0..1 "relative depth" per landmark where 0 = closest to camera
 * (typically nose tip) and 1 = farthest (silhouette edges).
 *
 * The renderer uses `relativeZ()` to modulate geometry intensity — a
 * visual "depth field", not a 3D scan.
 */

export interface DepthField {
  info: DepthInfo;
  /** normalized 0..1 per landmark, 0 = nearest */
  relative: Float32Array;
}

export function computeDepthField(lm: Landmark[] | null): DepthField | null {
  if (!lm || lm.length === 0) return null;

  let zmin = Infinity, zmax = -Infinity;
  for (const p of lm) {
    if (p.z < zmin) zmin = p.z;
    if (p.z > zmax) zmax = p.z;
  }
  const range = zmax - zmin;
  const relative = new Float32Array(lm.length);
  if (range < 1e-6) {
    return { info: { range: 0, valid: false }, relative };
  }
  for (let i = 0; i < lm.length; i++) {
    relative[i] = (lm[i].z - zmin) / range;
  }
  return { info: { range, valid: true }, relative };
}
