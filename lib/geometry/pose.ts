import type { HeadPose, Landmark } from "@/types/vision";

/**
 * Head pose estimation.
 *
 * Primary source: the facial transformation matrix emitted by
 * FaceLandmarker (column-major 4x4 mapping the canonical face model into
 * camera space). We decompose the rotation block into Tait-Bryan angles.
 *
 * Fallback: geometric estimate from landmark geometry (nose tip vs. eye /
 * ear symmetry) for frames where the matrix is absent.
 */

export function poseFromMatrix(m: Float32Array | number[]): HeadPose {
  // Column-major layout: m[0..3] = col0, m[4..7] = col1, ...
  const r00 = m[0];
  const r10 = m[1];
  const r20 = m[2], r21 = m[6], r22 = m[10];

  const pitch = Math.atan2(-r20, Math.hypot(r00, r10));
  const yaw = Math.atan2(r10, r00);
  const roll = Math.atan2(r21, r22);

  // MediaPipe's face model faces -Z toward the camera with +Y up; the
  // signs below are adjusted so the values match what a viewer sees on
  // the mirrored preview.
  return {
    yawDeg: radToDeg(-yaw),
    pitchDeg: radToDeg(pitch),
    rollDeg: radToDeg(-roll),
  };
}

// Canonical landmark indices (MediaPipe 478-pt topology)
const NOSE_TIP = 4;
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;
const FOREHEAD = 10;
const CHIN = 152;

export function poseFromLandmarks(lm: Landmark[]): HeadPose | null {
  if (lm.length <= RIGHT_EYE_OUTER) return null;

  const nose = lm[NOSE_TIP];
  const le = lm[LEFT_EYE_OUTER];
  const re = lm[RIGHT_EYE_OUTER];
  const fh = lm[FOREHEAD];
  const chin = lm[CHIN];

  const eyeSpan = Math.hypot(re.x - le.x, re.y - le.y);
  if (eyeSpan < 1e-5) return null;

  // Yaw: nose displacement from the eye midpoint, normalized by eye span.
  const midX = (le.x + re.x) / 2;
  const yaw = (nose.x - midX) / eyeSpan;

  // Pitch: nose position along the forehead→chin axis.
  const faceH = chin.y - fh.y;
  const pitch = faceH > 1e-5 ? (nose.y - (fh.y + chin.y) / 2) / faceH : 0;

  // Roll: tilt of the eye line.
  const roll = Math.atan2(re.y - le.y, re.x - le.x);

  return {
    yawDeg: yaw * 90,        // heuristic scaling to degrees
    pitchDeg: pitch * 90,
    rollDeg: radToDeg(roll),
  };
}

function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}
