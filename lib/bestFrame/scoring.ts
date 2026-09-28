import type {
  BoundingBox,
  GazeEstimate,
  HeadPose,
  LightingInfo,
} from "@/types/vision";

/**
 * Best-frame scoring — normalized 0..1 sub-scores weighted toward stable
 * visibility and good lighting. Honest, measurable criteria only.
 */

export interface FrameScoreInput {
  stability: number;       // 0..1 temporal landmark stability
  confidence: number;      // 0..1 presence persistence
  occluded: boolean;
  pose: HeadPose | null;
  gaze: GazeEstimate | null;
  lighting: LightingInfo | null;
  boundingBox: BoundingBox | null;
}

export interface FrameScore {
  total: number; // 0..1
  parts: {
    visibility: number;
    lighting: number;
    framing: number;
    angle: number;
    gaze: number;
    steadiness: number;
  };
}

export function scoreFrame(i: FrameScoreInput): FrameScore {
  const visibility = i.occluded
    ? 0.2
    : i.confidence * 0.6 + i.stability * 0.4;

  const lm = i.lighting;
  const lighting = !lm
    ? 0.5
    : (lm.mean > 0.32 && lm.mean < 0.8
        ? 1
        : lm.mean <= 0.32
          ? lm.mean / 0.32
          : Math.max(0, 1 - (lm.mean - 0.8) * 4)) *
        0.7 +
      (lm.contrast > 0.08 && lm.contrast < 0.32 ? 1 : 0.5) * 0.3;

  // framing: face occupies 25–60% of width, roughly centered
  let framing = 0;
  if (i.boundingBox) {
    const { w, x } = i.boundingBox;
    const sizeFit =
      w < 0.22 ? w / 0.22 : w > 0.65 ? Math.max(0, 1 - (w - 0.65) * 2.8) : 1;
    const center = 1 - Math.min(1, Math.abs(x + w / 2 - 0.5) * 2.4);
    framing = sizeFit * 0.55 + center * 0.45;
  }

  // angle: frontal preferred, mild ¾ acceptable
  const yaw = Math.abs(i.pose?.yawDeg ?? 90);
  const pitch = Math.abs(i.pose?.pitchDeg ?? 90);
  const roll = Math.abs(i.pose?.rollDeg ?? 90);
  const angle =
    (yaw < 12 ? 1 : yaw < 30 ? 0.75 : yaw < 45 ? 0.4 : 0.15) *
    (pitch < 15 ? 1 : pitch < 30 ? 0.7 : 0.4) *
    (roll < 10 ? 1 : 0.6);

  const gaze = i.gaze?.confidence ?? 0;
  const steadiness = i.stability;

  const total =
    visibility * 0.28 +
    lighting * 0.2 +
    angle * 0.16 +
    framing * 0.15 +
    gaze * 0.11 +
    steadiness * 0.1;

  return {
    total,
    parts: { visibility, lighting, framing, angle, gaze, steadiness },
  };
}
