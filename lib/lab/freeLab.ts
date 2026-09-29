import type {
  ExpressionVector,
  FacialDynamics,
  FreeLabUI,
  GazeEstimate,
  HeadPose,
  LabEventKind,
  Landmark,
  TimelineSample,
} from "@/types/vision";
import { expressionVector } from "@/lib/expression/vector";
import { TimelineRecorder } from "./timeline";

/**
 * Free Expression Lab engine — V7.2.
 *
 * Baseline → MOTION LIVE → FIELD STABLE loop with event-driven regional
 * activity. Reuses the V7.1-corrected displacement pipeline (centroid
 * alignment + ambient-motion discount + per-region saturation), adds a
 * bounded timeline recorder and a cooldown-gated event engine.
 *
 * Measures geometric motion only — no emotion/personality inference.
 */

export interface FreeLabInput {
  facePresent: boolean;
  landmarks: Landmark[] | null;
  dynamics: FacialDynamics | null;
  gaze: GazeEstimate | null;
  pose: HeadPose | null;
  stability: number;
}

type Phase = "idle" | "baseline" | "active" | "stable" | "frozen";

const BASELINE_MS = 850;       // short calibration hold
const STABLE_AFTER_MS = 1800;  // no-motion → FIELD STABLE
const EVENT_COOLDOWN = 1400;   // per-kind label cooldown
const MOTION_ON = 0.09;        // overall activity considered "moving"
const REGION_EVT = 0.35;       // regional event threshold

const REGION_KEYS = [
  "brow", "eyes", "nose", "mouth", "cheeks", "jaw", "silhouette",
] as const;

const cloneLm = (lm: Landmark[] | null): Landmark[] | null =>
  lm ? lm.map((p) => ({ ...p })) : null;

export class FreeLabEngine {
  private phase: Phase = "idle";
  private baseline: Landmark[] | null = null;
  private baselineDyn: FacialDynamics | null = null;
  private startT = 0;
  private holdStart = 0;
  private lastMotionT = 0;
  private smoothVec: ExpressionVector | null = null;
  private recent: { label: LabEventKind; at: number }[] = [];
  private lastFired = new Map<LabEventKind, number>();
  private timeline = new TimelineRecorder();
  private pendingEvents: LabEventKind[] = [];
  private prevGazeDx = 0;
  private prevYaw = 0;
  private prevPoseT = 0;
  private poseVel = 0;
  private frozenVec: ExpressionVector | null = null;
  private faceSeenAt = 0;
  private orientation = "FRONTAL";

  begin(now: number): void {
    this.phase = "baseline";
    this.baseline = null;
    this.baselineDyn = null;
    this.startT = now;
    this.holdStart = 0;
    this.lastMotionT = 0;
    this.smoothVec = null;
    this.frozenVec = null;
    this.recent = [];
    this.lastFired.clear();
    this.timeline.reset();
    this.pendingEvents = [];
    this.prevGazeDx = 0;
    this.prevYaw = 0;
    this.poseVel = 0;
  }

  /** Freeze the field at its current state; camera keeps tracking. */
  freeze(): void {
    if (this.phase === "active" || this.phase === "stable") {
      this.phase = "frozen";
      this.frozenVec = this.smoothVec ? { ...this.smoothVec } : null;
    }
  }

  /** Resume live motion analysis (baseline kept). */
  resume(now: number): void {
    if (this.phase === "frozen") {
      this.phase = "active";
      this.lastMotionT = now;
    }
  }

  get frozen(): boolean {
    return this.phase === "frozen";
  }

  snapshotTimeline(): TimelineSample[] {
    return this.timeline.samples.slice();
  }

  get baselineRef(): Landmark[] | null {
    return this.baseline;
  }

  private fire(kind: LabEventKind, now: number): void {
    const last = this.lastFired.get(kind) ?? -Infinity;
    if (now - last < EVENT_COOLDOWN) return;
    this.lastFired.set(kind, now);
    this.pendingEvents.push(kind);
    this.recent.push({ label: kind, at: now });
    if (this.recent.length > 6) this.recent.shift();
  }

  update(input: FreeLabInput, now: number): void {
    if (this.phase === "idle" || this.phase === "frozen") return;

    const face = input.facePresent && input.landmarks && input.dynamics;
    if (!face) {
      // tracking loss — pause without corrupting the timeline
      this.holdStart = 0;
      return;
    }
    this.faceSeenAt = now;

    // pose velocity — separates HEAD motion from facial deformation
    // (motion state); orientation is an absolute angle readout kept
    // independent so a stable side-facing head reports LEFT + STABLE.
    if (input.pose) {
      const dt = Math.max(0.016, (now - this.prevPoseT) / 1000);
      const vel = Math.abs(input.pose.yawDeg - this.prevYaw) / dt;
      this.poseVel = this.poseVel + 0.2 * (vel - this.poseVel);
      this.prevYaw = input.pose.yawDeg;
      this.prevPoseT = now;
      const y = input.pose.yawDeg;
      const p = input.pose.pitchDeg;
      this.orientation =
        Math.abs(p) > 16 && Math.abs(p) > Math.abs(y)
          ? p > 0
            ? "ELEVATED"
            : "LOWERED"
          : Math.abs(y) > 12
            ? y > 0
              ? "LEFT"
              : "RIGHT"
            : "FRONTAL";
    }

    if (this.phase === "baseline") {
      if ((input.stability ?? 0) > 0.5) {
        if (!this.holdStart) this.holdStart = now;
        if (now - this.holdStart >= BASELINE_MS) {
          this.baseline = cloneLm(input.landmarks);
          this.baselineDyn = input.dynamics ? { ...input.dynamics } : null;
          this.phase = "active";
          this.startT = now;
          this.lastMotionT = now;
        }
      } else {
        this.holdStart = 0;
      }
      return;
    }

    // active / stable
    const raw = expressionVector(this.baseline, input.landmarks);
    if (raw) {
      if (!this.smoothVec) this.smoothVec = { ...raw };
      else {
        for (const k of REGION_KEYS) {
          this.smoothVec[k] += (raw[k] - this.smoothVec[k]) * 0.28;
        }
        this.smoothVec.overall += (raw.overall - this.smoothVec.overall) * 0.28;
      }
    }
    const v = this.smoothVec;

    // event detection — real thresholds, cooldown-gated
    if (v) {
      if (v.mouth > REGION_EVT) this.fire("MOUTH RESPONSE", now);
      if (v.brow > REGION_EVT) this.fire("BROW RESPONSE", now);
      if (v.overall > 0.5) this.fire("MOTION PEAK", now);
    }
    if (input.gaze && Math.abs(input.gaze.dx - this.prevGazeDx) > 0.3)
      this.fire("GAZE SHIFT", now);
    if (input.gaze) this.prevGazeDx = input.gaze.dx;
    if (this.poseVel > 12) this.fire("HEAD TURN", now);

    const moving = (v?.overall ?? 0) > MOTION_ON || this.poseVel > 10;
    if (moving) {
      this.lastMotionT = now;
      if (this.phase === "stable") this.phase = "active";
    } else if (this.phase === "active" && now - this.lastMotionT > STABLE_AFTER_MS) {
      this.phase = "stable";
      this.fire("FIELD STABLE", now);
    }

    // timeline sample — events fired this frame attach to this sample
    const events = this.pendingEvents;
    this.pendingEvents = [];
    this.timeline.push(now - this.startT, {
      regions: {
        brow: v?.brow ?? 0,
        eyes: v?.eyes ?? 0,
        nose: v?.nose ?? 0,
        mouth: v?.mouth ?? 0,
        cheeks: v?.cheeks ?? 0,
        jaw: v?.jaw ?? 0,
      },
      pose: {
        yaw: input.pose?.yawDeg ?? 0,
        pitch: input.pose?.pitchDeg ?? 0,
        roll: input.pose?.rollDeg ?? 0,
      },
      gaze: {
        dx: input.gaze?.dx ?? 0,
        dy: input.gaze?.dy ?? 0,
      },
      motion: v?.overall ?? 0,
      events,
    });
  }

  ui(now: number): FreeLabUI {
    const phase =
      this.phase === "frozen"
        ? "frozen"
        : this.phase === "baseline"
          ? "baseline"
          : this.phase === "stable"
            ? "stable"
            : "active";
    const faceGone =
      (phase === "active" || phase === "stable") && now - this.faceSeenAt > 500;
    const instruction = faceGone
      ? "FACE LOST"
      : phase === "baseline"
        ? "CALIBRATING BASELINE"
        : phase === "stable"
          ? "MOTION FIELD STABLE"
          : phase === "frozen"
            ? "MOTION FROZEN"
            : "MOTION LIVE";
    return {
      phase,
      instruction,
      holdProgress:
        phase === "baseline" && this.holdStart
          ? Math.min(1, (now - this.holdStart) / BASELINE_MS)
          : 0,
      regions: this.phase === "frozen" ? this.frozenVec : this.smoothVec,
      poseMoving: this.poseVel > 10,
      poseOrientation: this.orientation,
      baseline: this.baseline,
      recentEvents: this.recent,
      durationMs: now - this.startT,
      samples: this.timeline.length,
    };
  }
}
