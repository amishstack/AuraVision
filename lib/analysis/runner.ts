import { computeSymmetry } from "@/lib/analysis/symmetry";
import { measureProportions } from "@/lib/analysis/proportions";
import { analyzePalette } from "@/lib/analysis/palette";
import { deriveVibe } from "@/lib/analysis/vibe";
import type {
  AnalysisReport,
  BoundingBox,
  FacialDynamics,
  GazeEstimate,
  HeadPose,
  Landmark,
  LightingInfo,
  ScanPhaseUI,
} from "@/types/vision";

/**
 * Deep Analysis — an 8-phase guided pass that produces an
 * AnalysisReport. Reuses the same live pipeline outputs; adds no new
 * inference. Everything is descriptive/experimental — no evaluative or
 * identity claims.
 *
 * Phases:
 *   0 ACQUIRING FACE GEOMETRY     (frontal, ~1.0s)
 *   1 ANALYZING FACIAL SYMMETRY   (~0.9s)
 *   2 ANALYZING PROPORTIONAL      (~0.8s)
 *   3 ANALYZING GAZE              (~1.2s)
 *   4 ANALYZING FACIAL DYNAMICS   (~1.2s)
 *   5 ANALYZING LIGHTING          (~0.7s)
 *   6 CAMERA ANGLES               (guided turns, per-pose holds)
 *   7 GENERATING VISUAL SIGNATURE (~0.7s)
 */

export const PHASE_LABELS = [
  "GEOMETRY",
  "SYMMETRY",
  "PROPORTION",
  "GAZE",
  "DYNAMICS",
  "LIGHTING",
  "ANGLES",
  "SIGNATURE",
];

const PHASE_MS = [1000, 900, 800, 1200, 1200, 700, 0, 700]; // 6 is pose-gated
const FRONTAL_MAX_YAW = 14;
const SIDE_MIN_YAW = 15;
const ANGLE_HOLD_MS = 700;
const ANGLE_TIMEOUT_MS = 8000;

interface Capture {
  points: Landmark[];
  yaw: number;
  stability: number;
}

interface SubBag {
  points: Float32Array;
  n: number;
  yawSum: number;
  stabSum: number;
  holdStart: number;
}

export class DeepAnalysisRunner {
  private phase = 0;
  private phaseStart = 0;
  private startAt = 0;

  // angle sub-phase (phase 6): 0 frontal, 1 side, 2 opposite, 3 frontal
  private subPhase = 0;
  private subStart = 0;
  private sideSign = 0;
  private bag: SubBag | null = null;
  private captures: Capture[] = [];

  // metric accumulators
  private symSum = 0;
  private symN = 0;
  private symField: Float32Array | null = null;
  private symAxisX = 0.5;
  private propScores: number[] = [];
  private propItems: import("@/types/vision").ProportionItem[] = [];
  private propLabel: "BALANCED" | "MODERATE" | "VARIABLE" = "MODERATE";
  private gazeCounts = { CENTER: 0, LEFT: 0, RIGHT: 0, OTHER: 0 };
  private gazeConfSum = 0;
  private gazeN = 0;
  private energySum = 0;
  private smileSum = 0;
  private dynN = 0;
  private rollAbsSum = 0;
  private stabSum = 0;
  private stabN = 0;
  private frameCxSum = 0;
  private frameWSum = 0;
  private lastLight: LightingInfo | null = null;
  private landmarkMax = 0;
  private landmarkRef: Landmark[] | null = null;
  private secondFaceFrames = 0;
  private totalFrames = 0;
  private secondFaceOffset = 0; // mean x offset of secondary face

  begin(now: number): void {
    this.phase = 0;
    this.phaseStart = now;
    this.startAt = now;
    this.subPhase = 0;
    this.subStart = now;
    this.sideSign = 0;
    this.bag = null;
    this.captures = [];
    this.symSum = 0;
    this.symN = 0;
    this.symField = null;
    this.propScores = [];
    this.propItems = [];
    this.gazeCounts = { CENTER: 0, LEFT: 0, RIGHT: 0, OTHER: 0 };
    this.gazeConfSum = 0;
    this.gazeN = 0;
    this.energySum = 0;
    this.smileSum = 0;
    this.dynN = 0;
    this.rollAbsSum = 0;
    this.stabSum = 0;
    this.stabN = 0;
    this.frameCxSum = 0;
    this.frameWSum = 0;
    this.lastLight = null;
    this.landmarkMax = 0;
    this.landmarkRef = null;
    this.secondFaceFrames = 0;
    this.totalFrames = 0;
    this.secondFaceOffset = 0;
  }

  ui(now: number): ScanPhaseUI {
    const checks = PHASE_LABELS.map((_, i) => i < this.phase);
    let instruction = "";
    if (this.phase === 6) {
      instruction = ["LOOK FORWARD", "TURN LEFT OR RIGHT", "TURN THE OTHER WAY", "LOOK FORWARD"][this.subPhase] ?? "LOOK FORWARD";
    } else if (this.phase >= 7) {
      instruction = "GENERATING VISUAL SIGNATURE";
    } else {
      instruction = `ANALYZING ${PHASE_LABELS[this.phase]}`;
    }
    void now;
    return { instruction, checks, labels: PHASE_LABELS };
  }

  progress(now: number): number {
    if (this.phase >= 7) {
      return Math.min((now - this.phaseStart) / PHASE_MS[7], 1);
    }
    if (this.phase === 6) {
      return (6 + this.subPhase / 4) / 8;
    }
    const ms = PHASE_MS[this.phase] || 1;
    return (this.phase + Math.min((now - this.phaseStart) / ms, 1)) / 8;
  }

  isDone(now: number): boolean {
    return this.phase === 7 && now - this.phaseStart >= PHASE_MS[7];
  }

  /** Current symmetry field for the overlay ghost (phase 1). */
  symmetryFieldForRender(): Float32Array | null {
    return this.phase === 1 ? this.symField : null;
  }
  symmetryAxis(): number {
    return this.symAxisX;
  }
  isSymmetryPhase(): boolean {
    return this.phase === 1;
  }

  sample(input: {
    now: number;
    facePresent: boolean;
    stability: number;
    landmarkCount: number;
    landmarks: Landmark[] | null;
    boundingBox: BoundingBox | null;
    pose: HeadPose | null;
    gaze: GazeEstimate | null;
    dynamics: FacialDynamics | null;
    lighting: LightingInfo | null;
    facesDetected: number;
    secondFaceCx: number | null;
  }): void {
    const { now } = input;
    this.totalFrames++;
    if (input.facesDetected > 1) {
      this.secondFaceFrames++;
      if (input.secondFaceCx !== null) this.secondFaceOffset += input.secondFaceCx;
    }
    if (input.lighting) this.lastLight = input.lighting;
    if (input.facePresent && input.landmarks) {
      this.landmarkMax = Math.max(this.landmarkMax, input.landmarkCount);
      this.stabSum += input.stability;
      this.stabN++;
      if (input.pose) this.rollAbsSum += Math.abs(input.pose.rollDeg);
      if (input.boundingBox) {
        this.frameCxSum += input.boundingBox.x + input.boundingBox.w / 2;
        this.frameWSum += input.boundingBox.w;
      }
    }

    // --- phase-specific accumulation ----------------------------------
    if (this.phase === 0 && input.landmarks) {
      // hold a reference landmark frame (best stability sample)
      if (input.stability > 0.6 || !this.landmarkRef) {
        this.landmarkRef = input.landmarks.map((p) => ({ ...p }));
      }
    } else if (this.phase === 1 && input.landmarks) {
      const s = computeSymmetry(input.landmarks);
      if (s) {
        this.symSum += s.score;
        this.symN++;
        this.symAxisX = s.axisX;
        // running field average for the visual ghost
        if (!this.symField || this.symField.length !== s.field.length) {
          this.symField = new Float32Array(s.field);
        } else {
          for (let i = 0; i < s.field.length; i++) {
            this.symField[i] = this.symField[i] * 0.85 + s.field[i] * 0.15;
          }
        }
      }
    } else if (this.phase === 2 && input.landmarks) {
      const p = measureProportions(input.landmarks);
      if (p) {
        this.propScores.push(p.score);
        this.propItems = p.items;
        this.propLabel = p.label;
      }
    } else if (this.phase === 3 && input.gaze) {
      const key =
        input.gaze.label === "CENTER" ? "CENTER"
        : input.gaze.label === "LEFT" ? "LEFT"
        : input.gaze.label === "RIGHT" ? "RIGHT"
        : "OTHER";
      this.gazeCounts[key]++;
      this.gazeConfSum += input.gaze.confidence;
      this.gazeN++;
    } else if (this.phase === 4 && input.dynamics) {
      this.energySum += input.dynamics.energy;
      this.smileSum += input.dynamics.smile;
      this.dynN++;
    } else if (this.phase === 6) {
      this.sampleAngles(input, now);
    }

    // --- phase advancement ---------------------------------------------
    if (this.phase < 6 && now - this.phaseStart >= PHASE_MS[this.phase]) {
      this.advance(now);
    }
  }

  private sampleAngles(
    input: { landmarks: Landmark[] | null; pose: HeadPose | null; stability: number; facePresent: boolean },
    now: number,
  ): void {
    const yaw = input.pose?.yawDeg ?? 0;
    let ok = false;
    if (!input.facePresent || !input.landmarks || !input.pose) {
      ok = false;
    } else if (this.subPhase === 0 || this.subPhase === 3) {
      ok = Math.abs(yaw) < FRONTAL_MAX_YAW;
    } else if (this.subPhase === 1) {
      ok = Math.abs(yaw) > SIDE_MIN_YAW;
      if (ok && this.sideSign === 0) this.sideSign = Math.sign(yaw);
      if (this.sideSign !== 0) ok = Math.sign(yaw) === this.sideSign;
    } else {
      ok = this.sideSign !== 0 && Math.sign(yaw) === -this.sideSign && Math.abs(yaw) > SIDE_MIN_YAW;
    }

    if (ok) {
      if (!this.bag) {
        this.bag = {
          points: new Float32Array(input.landmarks!.length * 3),
          n: 0,
          yawSum: 0,
          stabSum: 0,
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
      this.bag.stabSum += input.stability;

      if (now - this.bag.holdStart >= ANGLE_HOLD_MS) {
        this.commitCapture();
        this.subPhase++;
        this.subStart = now;
        if (this.subPhase > 3) this.advance(now);
      }
    } else {
      this.bag = null;
    }
    if (now - this.subStart > ANGLE_TIMEOUT_MS) {
      this.commitCapture();
      this.subPhase++;
      this.subStart = now;
      if (this.subPhase > 3) this.advance(now);
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
        stability: this.bag.stabSum / this.bag.n,
      });
    }
    this.bag = null;
  }

  private advance(now: number): void {
    this.phase++;
    this.phaseStart = now;
  }

  finish(video: HTMLVideoElement | null): AnalysisReport {
    const symScore = this.symN ? Math.round(this.symSum / this.symN) : 0;
    const propScore = this.propScores.length
      ? Math.round(this.propScores.reduce((a, b) => a + b, 0) / this.propScores.length)
      : 0;
    const meanAbsRoll = this.stabN ? this.rollAbsSum / this.stabN : 0;

    // framing: face should occupy a reasonable slice of frame, centered
    const meanCx = this.stabN ? this.frameCxSum / this.stabN : 0.5;
    const meanW = this.stabN ? this.frameWSum / this.stabN : 0;
    const centerDist = Math.abs(meanCx - 0.5) * 2; // 0 center .. 1 edge
    const sizeFit =
      meanW <= 0 ? 0
      : meanW < 0.22 ? (meanW / 0.22) * 70
      : meanW > 0.7 ? Math.max(0, 100 - (meanW - 0.7) * 300)
      : 100;
    const framing = Math.round(Math.max(0, Math.min(100,
      sizeFit * 0.6 + (1 - centerDist) * 40)));

    const lm = this.lastLight;
    const lightScore = !lm ? 50 : Math.round(
      Math.max(0, Math.min(100,
        (lm.mean > 0.35 && lm.mean < 0.78 ? 100 : lm.mean <= 0.35 ? lm.mean / 0.35 * 80 : Math.max(0, 100 - (lm.mean - 0.78) * 300)) * 0.7 +
        (lm.contrast > 0.08 && lm.contrast < 0.3 ? 100 : 55) * 0.3)));

    const balance = Math.round(Math.max(0, Math.min(100, 100 - meanAbsRoll * 5)));

    const aesthetic = {
      symmetry: symScore,
      proportion: propScore,
      balance,
      framing,
      lighting: lightScore,
      total: Math.round(symScore * 0.25 + propScore * 0.2 + balance * 0.15 + framing * 0.15 + lightScore * 0.25),
    };

    // gaze signature
    const gTotal = Math.max(1, this.gazeN);
    const gazeStab =
      this.gazeN && this.gazeConfSum / this.gazeN > 0.6 ? "HIGH"
      : this.gazeN && this.gazeConfSum / this.gazeN > 0.35 ? "MEDIUM" : "LOW";

    // lighting report + suggestions
    const suggestions: string[] = [];
    let lightLabel = "GOOD";
    if (!lm) {
      lightLabel = "LOW";
    } else {
      if (lm.mean < 0.28) {
        lightLabel = "LOW";
        suggestions.push("MOVE TOWARD LIGHT");
      } else if (lm.mean > 0.82) {
        lightLabel = "MODERATE";
        suggestions.push("REDUCE DIRECT LIGHT");
      }
      if (lm.contrast > 0.32 && lm.mean < 0.5) {
        suggestions.push("REDUCE BACKLIGHT");
        if (lightLabel === "GOOD") lightLabel = "MODERATE";
      }
      const dirMag = Math.hypot(lm.dirX, lm.dirY);
      if (dirMag > 0.22) {
        suggestions.push(
          lm.dirX > 0 ? "ANGLE FACE SLIGHTLY LEFT" : "ANGLE FACE SLIGHTLY RIGHT",
        );
      }
      if (suggestions.length === 0) suggestions.push("FACE LIGHTING: GOOD");
    }

    // preferred view — capture with best stability
    let preferred = "FRONTAL";
    let bestStab = -1;
    for (const cap of this.captures) {
      if (cap.stability > bestStab) {
        bestStab = cap.stability;
        preferred =
          cap.yaw < -SIDE_MIN_YAW ? "LEFT 3/4"
          : cap.yaw > SIDE_MIN_YAW ? "RIGHT 3/4"
          : "FRONTAL";
      }
    }

    const energy = this.dynN ? this.energySum / this.dynN : 0;
    const smile = this.dynN ? this.smileSum / this.dynN : 0;
    const dynamicsLabel =
      energy > 0.5 ? "HIGH MOTION" : energy > 0.2 ? "MODERATE MOTION" : "LOW MOTION";

    const palette = video ? analyzePalette(video) : null;
    const vibe = deriveVibe({
      symmetry: symScore,
      lightingMean: lm?.mean ?? 0.5,
      lightingContrast: lm?.contrast ?? 0.2,
      dynamicsEnergy: energy,
      warm: palette
        ? palette.temperature === "WARM" ? 0.6 : palette.temperature === "COOL" ? -0.6 : 0
        : 0,
      smile,
    });

    const secondSeen = this.totalFrames > 0 && this.secondFaceFrames / this.totalFrames > 0.1;
    const compositionLabel = secondSeen
      ? `SECOND SUBJECT — ${(this.secondFaceOffset / this.secondFaceFrames) < 0.5 ? "FRAME LEFT" : "FRAME RIGHT"}`
      : null;

    return {
      aesthetic,
      symmetryPct: symScore,
      symmetryLabel: symScore > 75 ? "HIGH" : symScore > 50 ? "MODERATE" : "VARIABLE",
      proportions: this.propItems,
      proportionLabel: this.propLabel,
      preferredView: preferred,
      lighting: {
        label: lightLabel,
        detail: lm?.label ?? "UNDETERMINED",
        suggestions,
      },
      gaze: {
        center: this.gazeCounts.CENTER / gTotal,
        left: this.gazeCounts.LEFT / gTotal,
        right: this.gazeCounts.RIGHT / gTotal,
        other: this.gazeCounts.OTHER / gTotal,
        stabilityLabel: gazeStab,
      },
      dynamicsLabel,
      vibe,
      palette,
      signaturePoints: this.mergeViews(),
      viewsCaptured: this.captures.length,
      landmarkCount: this.landmarkMax,
      secondFaceSeen: secondSeen,
      compositionLabel,
    };
  }

  private mergeViews(): Float32Array | null {
    const src = this.captures.length > 0
      ? this.captures.map((c) => ({ points: c.points, yaw: c.yaw }))
      : this.landmarkRef
        ? [{ points: this.landmarkRef, yaw: 0 }]
        : [];
    if (src.length === 0) return null;
    const n = src[0].points.length;
    const out = new Float32Array(n * 3);
    let used = 0;
    for (const cap of src) {
      const pts = cap.points;
      if (pts.length !== n) continue;
      used++;
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
        out[i * 3] += cos * dx + sin * dz;
        out[i * 3 + 1] += pts[i].y;
        out[i * 3 + 2] += -sin * dx + cos * dz;
      }
    }
    if (used === 0) return null;
    for (let i = 0; i < out.length; i++) out[i] /= used;
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
