import type {
  FacialDynamics,
  GazeEstimate,
  HeadPose,
  Landmark,
  LightingInfo,
  ScanPhaseUI,
  VisualProfile,
} from "@/types/vision";

/**
 * Guided Deep Scan — a directed multi-angle acquisition pass.
 *
 * Phases: LOOK FORWARD → TURN → TURN (opposite) → LOOK FORWARD →
 * ANALYZING. Each phase accumulates landmark samples while the head pose
 * matches the request; a generous timeout advances gracefully if the
 * user can't hold the pose.
 *
 * Output: a merged canonical point cloud — each captured view is
 * de-rotated by its yaw into a frontal frame and averaged. This is an
 * honest "multi-view merged geometry" approximation, not metric 3D
 * reconstruction (roll/pitch alignment is approximate; documented).
 */

export const SCAN_PHASE_LABELS = ["FRONTAL", "LEFT", "RIGHT", "REFERENCE"];
const HOLD_MS = 800;        // required hold time per pose
const PHASE_TIMEOUT_MS = 9000;
const ANALYZE_MS = 900;
const FRONTAL_MAX_YAW = 14; // degrees
const SIDE_MIN_YAW = 15;

interface Capture {
  points: Landmark[]; // averaged landmarks for this view
  yaw: number;
  pitch: number;
}

interface SampleBag {
  points: Float32Array; // running sum, n*3
  n: number;
  yawSum: number;
  pitchSum: number;
  holdStart: number;
}

export class GuidedScan {
  private phase = 0; // 0..3 poses, 4 analyzing, 5 done
  private sideSign = 0; // +1 or -1 — first turn direction observed
  private phaseStart = 0;
  private bag: SampleBag | null = null;
  private captures: Capture[] = [];
  private analyzeStart = 0;

  // metric accumulators
  private samples = 0;
  private stabilitySum = 0;
  private presenceSum = 0;
  private gazeConfSum = 0;
  private gazeSamples = 0;
  private energySum = 0;
  private energySamples = 0;
  private landmarkMax = 0;
  private yawVals: number[] = [];
  private lastLight: LightingInfo | null = null;

  begin(now: number): void {
    this.phase = 0;
    this.sideSign = 0;
    this.phaseStart = now;
    this.bag = null;
    this.captures = [];
    this.analyzeStart = 0;
    this.samples = 0;
    this.stabilitySum = 0;
    this.presenceSum = 0;
    this.gazeConfSum = 0;
    this.gazeSamples = 0;
    this.energySum = 0;
    this.energySamples = 0;
    this.landmarkMax = 0;
    this.yawVals = [];
    this.lastLight = null;
  }

  ui(): ScanPhaseUI {
    const names = SCAN_PHASE_LABELS;
    const checks = names.map((_, i) => i < this.phase);
    const instruction =
      this.phase === 0 || this.phase === 3
        ? "LOOK FORWARD"
        : this.phase === 1
          ? "TURN LEFT OR RIGHT"
          : this.phase === 2
            ? "TURN THE OTHER WAY"
            : this.phase === 4
              ? "ANALYZING"
              : "COMPLETE";
    return { instruction, checks, labels: names };
  }

  progress(now: number): number {
    if (this.phase >= 4) {
      if (this.phase === 4) {
        return 0.9 + 0.1 * Math.min((now - this.analyzeStart) / ANALYZE_MS, 1);
      }
      return 1;
    }
    const base = this.phase / 5;
    const held = this.bag ? (now - this.bag.holdStart) / HOLD_MS : 0;
    return base + Math.min(held, 1) / 5;
  }

  isDone(now: number): boolean {
    return this.phase === 4 && now - this.analyzeStart >= ANALYZE_MS;
  }

  sample(input: {
    now: number;
    facePresent: boolean;
    stability: number;
    presence: number;
    landmarkCount: number;
    landmarks: Landmark[] | null;
    pose: HeadPose | null;
    gaze: GazeEstimate | null;
    dynamics: FacialDynamics | null;
    lighting: LightingInfo | null;
  }): void {
    this.samples++;
    this.presenceSum += input.facePresent ? 1 : 0;
    this.stabilitySum += input.stability;
    this.landmarkMax = Math.max(this.landmarkMax, input.landmarkCount);
    if (input.pose) this.yawVals.push(input.pose.yawDeg);
    if (input.gaze) {
      this.gazeConfSum += input.gaze.confidence;
      this.gazeSamples++;
    }
    if (input.dynamics) {
      this.energySum += input.dynamics.energy;
      this.energySamples++;
    }
    if (input.lighting) this.lastLight = input.lighting;

    if (this.phase >= 4) return;

    const now = input.now;
    const yaw = input.pose?.yawDeg ?? 0;
    const pitch = input.pose?.pitchDeg ?? 0;

    // Phase gate — is the current pose acceptable for this phase?
    let ok = false;
    if (!input.facePresent || !input.landmarks || !input.pose) {
      ok = false;
    } else if (this.phase === 0 || this.phase === 3) {
      ok = Math.abs(yaw) < FRONTAL_MAX_YAW;
    } else if (this.phase === 1) {
      ok = Math.abs(yaw) > SIDE_MIN_YAW;
      if (ok && this.sideSign === 0) this.sideSign = Math.sign(yaw);
      if (this.sideSign !== 0) ok = Math.sign(yaw) === this.sideSign;
    } else if (this.phase === 2) {
      ok = this.sideSign !== 0 && Math.sign(yaw) === -this.sideSign &&
        Math.abs(yaw) > SIDE_MIN_YAW;
    }

    if (ok) {
      if (!this.bag) {
        this.bag = {
          points: new Float32Array(input.landmarks!.length * 3),
          n: 0,
          yawSum: 0,
          pitchSum: 0,
          holdStart: now,
        };
      }
      const lm = input.landmarks!;
      for (let i = 0; i < lm.length; i++) {
        this.bag.points[i * 3] += lm[i].x;
        this.bag.points[i * 3 + 1] += lm[i].y;
        this.bag.points[i * 3 + 2] += lm[i].z;
      }
      this.bag.n++;
      this.bag.yawSum += yaw;
      this.bag.pitchSum += pitch;

      if (now - this.bag.holdStart >= HOLD_MS) {
        this.commitCapture();
        this.advance(now);
      }
    } else {
      this.bag = null; // pose broken — reset hold
    }

    // Graceful timeout — accept whatever was captured (or none).
    if (now - this.phaseStart > PHASE_TIMEOUT_MS) {
      this.commitCapture();
      this.advance(now);
    }
  }

  private commitCapture(): void {
    if (this.bag && this.bag.n > 0) {
      const pts: Landmark[] = [];
      for (let i = 0; i < this.bag.points.length / 3; i++) {
        pts.push({
          x: this.bag.points[i * 3] / this.bag.n,
          y: this.bag.points[i * 3 + 1] / this.bag.n,
          z: this.bag.points[i * 3 + 2] / this.bag.n,
        });
      }
      this.captures.push({
        points: pts,
        yaw: this.bag.yawSum / this.bag.n,
        pitch: this.bag.pitchSum / this.bag.n,
      });
    }
    this.bag = null;
  }

  private advance(now: number): void {
    this.phase++;
    this.phaseStart = now;
    if (this.phase === 4) this.analyzeStart = now;
  }

  finish(): VisualProfile {
    const n = Math.max(this.samples, 1);
    const stabilityPct = Math.round((this.stabilitySum / n) * 100);
    const gazePct = this.gazeSamples
      ? Math.round((this.gazeConfSum / this.gazeSamples) * 100)
      : 0;
    const energy = this.energySamples ? this.energySum / this.energySamples : 0;
    const presence = this.presenceSum / n;
    const merged = this.mergeViews();

    return {
      durationMs: 0,
      geometry:
        this.captures.length >= 3
          ? "MULTI-VIEW GEOMETRY ACQUIRED"
          : this.captures.length > 0
            ? "FACIAL GEOMETRY ACQUIRED"
            : "PARTIAL GEOMETRY",
      stabilityPct,
      stabilityLabel:
        stabilityPct > 75 ? "HIGH" : stabilityPct > 45 ? "MODERATE" : "LOW",
      poseSpreadDeg: Math.round(spread(this.yawVals) * 10) / 10,
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
      signaturePoints: merged,
      signaturePointCount: merged ? merged.length / 3 : 0,
      viewsCaptured: this.captures.length,
    };
  }

  /**
   * Merge captured views into one canonical cloud: de-rotate each view
   * by its mean yaw about the face center axis, then average aligned
   * points. Side views contribute better depth on their exposed side —
   * approximated here by plain averaging after de-rotation.
   */
  private mergeViews(): Float32Array | null {
    if (this.captures.length === 0) return null;
    const n = this.captures[0].points.length;
    const out = new Float32Array(n * 3);

    for (const cap of this.captures) {
      const pts = cap.points;
      if (pts.length !== n) continue;
      // face center
      let cx = 0, cz = 0;
      for (const p of pts) {
        cx += p.x;
        cz += p.z;
      }
      cx /= n;
      cz /= n;
      const yaw = (-cap.yaw * Math.PI) / 180;
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      for (let i = 0; i < n; i++) {
        const dx = pts[i].x - cx;
        const dz = pts[i].z - cz;
        // inverse yaw rotation about the vertical axis
        out[i * 3] += cos * dx + sin * dz;
        out[i * 3 + 1] += pts[i].y;
        out[i * 3 + 2] += -sin * dx + cos * dz;
      }
    }
    const m = this.captures.length;
    for (let i = 0; i < out.length; i++) out[i] /= m;

    // Center + normalize scale for display.
    let cy = 0, cx = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      cx += out[i * 3];
      cy += out[i * 3 + 1];
      cz += out[i * 3 + 2];
    }
    cx /= n;
    cy /= n;
    cz /= n;
    let maxR = 0;
    for (let i = 0; i < n; i++) {
      const dx = (out[i * 3] -= cx);
      const dy = (out[i * 3 + 1] -= cy);
      const dz = (out[i * 3 + 2] -= cz);
      maxR = Math.max(maxR, Math.hypot(dx, dy, dz));
    }
    if (maxR > 1e-6) {
      for (let i = 0; i < out.length; i++) out[i] /= maxR;
    }
    return out;
  }
}

function spread(vals: number[]): number {
  if (vals.length < 2) return 0;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
}
