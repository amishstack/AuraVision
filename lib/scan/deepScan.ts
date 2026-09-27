import type {
  FacialDynamics,
  GazeEstimate,
  HeadPose,
  LightingInfo,
  VisualProfile,
} from "@/types/vision";

/**
 * Deep Scan — a fixed-duration temporal sampling pass. Accumulates
 * per-frame metrics and distills them into a qualitative VisualProfile.
 * Everything produced here is descriptive telemetry; no evaluative or
 * identity claims are made.
 */

export const DEEP_SCAN_DURATION_MS = 4000;

export class DeepScanCollector {
  private startAt = 0;
  private samples = 0;
  private stabilitySum = 0;
  private yawVals: number[] = [];
  private pitchVals: number[] = [];
  private rollVals: number[] = [];
  private gazeConfSum = 0;
  private gazeSamples = 0;
  private energySum = 0;
  private energySamples = 0;
  private landmarkMax = 0;
  private lastLight: LightingInfo | null = null;
  private presenceSum = 0;

  begin(now: number): void {
    this.startAt = now;
    this.samples = 0;
    this.stabilitySum = 0;
    this.yawVals = [];
    this.pitchVals = [];
    this.rollVals = [];
    this.gazeConfSum = 0;
    this.gazeSamples = 0;
    this.energySum = 0;
    this.energySamples = 0;
    this.landmarkMax = 0;
    this.lastLight = null;
    this.presenceSum = 0;
  }

  progress(now: number): number {
    return Math.min((now - this.startAt) / DEEP_SCAN_DURATION_MS, 1);
  }

  isDone(now: number): boolean {
    return now - this.startAt >= DEEP_SCAN_DURATION_MS;
  }

  sample(input: {
    now: number;
    facePresent: boolean;
    stability: number;
    presence: number;
    landmarkCount: number;
    pose: HeadPose | null;
    gaze: GazeEstimate | null;
    dynamics: FacialDynamics | null;
    lighting: LightingInfo | null;
  }): void {
    this.samples++;
    this.presenceSum += input.facePresent ? 1 : 0;
    this.stabilitySum += input.stability;
    this.landmarkMax = Math.max(this.landmarkMax, input.landmarkCount);
    if (input.pose) {
      this.yawVals.push(input.pose.yawDeg);
      this.pitchVals.push(input.pose.pitchDeg);
      this.rollVals.push(input.pose.rollDeg);
    }
    if (input.gaze) {
      this.gazeConfSum += input.gaze.confidence;
      this.gazeSamples++;
    }
    if (input.dynamics) {
      this.energySum += input.dynamics.energy;
      this.energySamples++;
    }
    if (input.lighting) this.lastLight = input.lighting;
  }

  finish(): VisualProfile {
    const n = Math.max(this.samples, 1);
    const stabilityPct = Math.round((this.stabilitySum / n) * 100);
    const poseSpread = spread(this.yawVals);
    const gazePct = this.gazeSamples
      ? Math.round((this.gazeConfSum / this.gazeSamples) * 100)
      : 0;
    const energy = this.energySamples ? this.energySum / this.energySamples : 0;
    const presence = this.presenceSum / n;

    return {
      durationMs: DEEP_SCAN_DURATION_MS,
      geometry:
        this.landmarkMax >= 470
          ? "DENSE LANDMARK FIELD ACQUIRED"
          : "PARTIAL LANDMARK FIELD",
      stabilityPct,
      stabilityLabel:
        stabilityPct > 75 ? "HIGH" : stabilityPct > 45 ? "MODERATE" : "LOW",
      poseSpreadDeg: Math.round(poseSpread * 10) / 10,
      gazeConfidencePct: gazePct,
      dynamicsEnergy: energy > 0.5 ? "HIGH" : energy > 0.2 ? "MODERATE" : "LOW",
      lighting: this.lastLight?.label ?? "UNDETERMINED",
      trackingQuality:
        presence > 0.95 && stabilityPct > 60
          ? "STABLE"
          : presence > 0.8
            ? "INTERMITTENT"
            : "DEGRADED",
      landmarkCount: this.landmarkMax,
    };
  }
}

function spread(vals: number[]): number {
  if (vals.length < 2) return 0;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
}
