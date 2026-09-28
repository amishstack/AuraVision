import type {
  ExpressionLabResult,
  ExpressionLabUI,
  ExpressionVector,
  FacialDynamics,
  GazeEstimate,
  HeadPose,
  Landmark,
} from "@/types/vision";
import { expressionVector, aggregateVectors } from "./vector";

/**
 * Expression Lab — neutral-baseline capture + controlled-movement
 * challenges. All detection is geometric: current landmark field vs. the
 * subject's own frozen baseline. No emotion classification, no claims.
 */

export interface LabInput {
  facePresent: boolean;
  landmarks: Landmark[] | null;
  dynamics: FacialDynamics | null;
  gaze: GazeEstimate | null;
  pose: HeadPose | null;
  stability: number;
}

interface Challenge {
  id: string;
  label: string;
  test: (
    base: FacialDynamics,
    cur: FacialDynamics,
    gaze: GazeEstimate | null,
    pose: HeadPose | null,
    vector: ExpressionVector | null,
  ) => boolean;
}

const CHALLENGES: Challenge[] = [
  {
    id: "smile",
    label: "SMILE",
    test: (b, c) =>
      c.smile - b.smile > 0.15 || c.lipSpread - b.lipSpread > 0.05,
  },
  {
    id: "open",
    label: "OPEN MOUTH",
    test: (b, c) =>
      c.mouthAperture - b.mouthAperture > 0.22 || c.jawOpen - b.jawOpen > 0.25,
  },
  {
    id: "brows",
    label: "RAISE BROWS",
    test: (b, c) => c.browRaise - b.browRaise > 0.18,
  },
  {
    id: "left",
    label: "LOOK LEFT",
    test: (_b, _c, gaze, pose) =>
      (gaze?.label?.includes("LEFT") ?? false) || (pose?.yawDeg ?? 0) > 14,
  },
  {
    id: "right",
    label: "LOOK RIGHT",
    test: (_b, _c, gaze, pose) =>
      (gaze?.label?.includes("RIGHT") ?? false) || (pose?.yawDeg ?? 0) < -14,
  },
  {
    id: "relax",
    label: "RELAX",
    test: (_b, _c, _g, _p, v) => (v?.overall ?? 1) < 0.12,
  },
];

const BASELINE_MS = 1000;   // stable-hold to freeze the neutral baseline
const DETECT_MS = 350;      // sustained detection before capture
const CAPTURED_MS = 900;    // "CAPTURED" beat between challenges
const TIMEOUT_MS = 9000;    // never leave the user stuck on a challenge

type Phase = "idle" | "baseline" | "prompt" | "capture" | "done";

const cloneLm = (lm: Landmark[] | null): Landmark[] | null =>
  lm ? lm.map((p) => ({ ...p })) : null;

export class ExpressionLabEngine {
  private phase: Phase = "idle";
  private baseline: Landmark[] | null = null;
  private baselineDyn: FacialDynamics | null = null;
  private idx = 0;
  private phaseStart = 0;
  private holdStart = 0;
  private results: { id: string; label: string; vector: ExpressionVector }[] = [];
  private lastLm: Landmark[] | null = null;
  private liveVector: ExpressionVector | null = null;

  begin(now: number): void {
    this.phase = "baseline";
    this.baseline = null;
    this.baselineDyn = null;
    this.idx = 0;
    this.phaseStart = now;
    this.holdStart = 0;
    this.results = [];
    this.lastLm = null;
    this.liveVector = null;
  }

  isDone(): boolean {
    return this.phase === "done";
  }

  private get challenge(): Challenge | null {
    return this.idx < CHALLENGES.length ? CHALLENGES[this.idx] : null;
  }

  update(input: LabInput, now: number): void {
    if (this.phase === "idle" || this.phase === "done") return;

    // Face temporarily absent — pause, never trap the user.
    if (!input.facePresent || !input.landmarks || !input.dynamics) {
      this.holdStart = 0;
      return;
    }

    this.liveVector = this.baseline
      ? expressionVector(this.baseline, input.landmarks)
      : null;

    if (this.phase === "baseline") {
      if ((input.stability ?? 0) > 0.5) {
        if (!this.holdStart) this.holdStart = now;
        if (now - this.holdStart >= BASELINE_MS) {
          this.baseline = cloneLm(input.landmarks);
          this.baselineDyn = { ...input.dynamics };
          this.phase = "prompt";
          this.phaseStart = now;
          this.holdStart = 0;
        }
      } else {
        this.holdStart = 0;
      }
      return;
    }

    if (this.phase === "prompt") {
      const ch = this.challenge;
      if (!ch) {
        this.phase = "done";
        return;
      }
      const hit = this.baselineDyn
        ? ch.test(
            this.baselineDyn,
            input.dynamics,
            input.gaze,
            input.pose,
            this.liveVector,
          )
        : false;
      if (hit) {
        if (!this.holdStart) this.holdStart = now;
        if (now - this.holdStart >= DETECT_MS) {
          this.results.push({
            id: ch.id,
            label: ch.label,
            vector:
              this.liveVector ??
              expressionVector(this.baseline, input.landmarks) ??
              ({
                brow: 0, eyes: 0, nose: 0, mouth: 0,
                cheeks: 0, jaw: 0, silhouette: 0, overall: 0,
              } as ExpressionVector),
          });
          this.lastLm = cloneLm(input.landmarks);
          this.phase = "capture";
          this.phaseStart = now;
          this.holdStart = 0;
        }
      } else {
        this.holdStart = 0;
        // timeout → record whatever the field shows and move on
        if (now - this.phaseStart >= TIMEOUT_MS) {
          this.results.push({
            id: ch.id,
            label: ch.label,
            vector:
              this.liveVector ?? ({
                brow: 0, eyes: 0, nose: 0, mouth: 0,
                cheeks: 0, jaw: 0, silhouette: 0, overall: 0,
              } as ExpressionVector),
          });
          this.lastLm = cloneLm(input.landmarks);
          this.phase = "capture";
          this.phaseStart = now;
        }
      }
      return;
    }

    if (this.phase === "capture") {
      if (now - this.phaseStart >= CAPTURED_MS) {
        this.idx++;
        this.phase = this.idx >= CHALLENGES.length ? "done" : "prompt";
        this.phaseStart = now;
        this.holdStart = 0;
      }
    }
  }

  ui(now: number): ExpressionLabUI {
    const ch = this.challenge;
    const instruction =
      this.phase === "baseline"
        ? "LOOK FORWARD — HOLD STILL"
        : this.phase === "capture"
          ? "CAPTURED"
          : this.holdStart
            ? "HOLD"
            : (ch?.label ?? "");
    const holdProgress =
      this.phase === "baseline"
        ? this.holdStart
          ? Math.min(1, (now - this.holdStart) / BASELINE_MS)
          : 0
        : this.phase === "prompt"
          ? this.holdStart
            ? Math.min(1, (now - this.holdStart) / DETECT_MS)
            : 0
          : this.phase === "capture"
            ? Math.min(1, (now - this.phaseStart) / CAPTURED_MS)
            : 0;
    return {
      phase:
        this.phase === "baseline"
          ? "baseline"
          : this.phase === "capture"
            ? "capture"
            : "prompt",
      instruction,
      challengeLabel: ch?.label ?? null,
      challengeIndex: this.idx,
      challengeTotal: CHALLENGES.length,
      holdProgress,
      vector: this.liveVector,
      baseline: this.baseline,
    };
  }

  finish(): ExpressionLabResult {
    const aggregate = aggregateVectors(this.results.map((r) => r.vector));
    const responseLabel =
      aggregate.overall > 0.55
        ? "HIGH DYNAMIC RESPONSE"
        : aggregate.overall > 0.3
          ? "MODERATE DYNAMIC RESPONSE"
          : "SUBTLE DYNAMIC RESPONSE";
    this.phase = "idle";
    return {
      challenges: this.results,
      aggregate,
      responseLabel,
      baseline: this.baseline,
      lastLandmarks: this.lastLm,
    };
  }
}
