import { scoreFrame, type FrameScoreInput } from "@/lib/bestFrame/scoring";
import type { BestFrameCandidate } from "@/lib/bestFrame/bestFrame";
import { toBestFrameResult } from "@/lib/bestFrame/bestFrame";
import { analyzePalette } from "@/lib/analysis/palette";
import { deriveAura } from "@/lib/analysis/aura";
import type {
  BoundingBox,
  DirectorResult,
  DirectorTarget,
  DirectorUI,
  FacialDynamics,
  Landmark,
  LightingInfo,
  PortraitReadiness,
} from "@/types/vision";

/**
 * Director Mode — guided portrait composition. Evaluates the live frame
 * against ordered checks each tick (~render rate, cheap O(1) math) and
 * surfaces ONE instruction: the first unsatisfied condition. Satisfied
 * checks are skipped automatically — the flow feels intelligent, not
 * bureaucratic. Reuses scoreFrame for the composition score and
 * BestFrameEngine's candidate buffer for the final capture.
 */

const HOLD_MS = 950;          // ready-hold before PORTRAIT READY
const INIT_MS = 900;

export interface DirectorInput extends FrameScoreInput {
  facePresent: boolean;
  landmarks: Landmark[] | null;
  dynamics: FacialDynamics | null;
}

interface Check {
  id: string;
  test: (i: DirectorInput, now: number) => boolean;
  instruct: (i: DirectorInput, now: number) => string;
}

const faceW = (bb: BoundingBox | null) => bb?.w ?? 0;
const cx = (bb: BoundingBox | null) => (bb ? bb.x + bb.w / 2 : 0.5);
const cy = (bb: BoundingBox | null) => (bb ? bb.y + bb.h / 2 : 0.5);

const lightScore01 = (lm: LightingInfo | null): number =>
  !lm
    ? 0.5
    : (lm.mean > 0.32 && lm.mean < 0.8
          ? 1
          : lm.mean <= 0.32
            ? lm.mean / 0.32
            : Math.max(0, 1 - (lm.mean - 0.8) * 4)) *
        0.7 +
      (lm.contrast > 0.08 && lm.contrast < 0.32 ? 1 : 0.5) * 0.3;

export class DirectorEngine {
  private target: DirectorTarget = "frontal";
  private targetLocked = false;
  private adoptUntil = 0; // window to adopt the user's natural angle
  private startAt = 0;
  private readySince = 0;
  private forceDone = false;
  private firstBadAt = 0;
  private lastLight: LightingInfo | null = null;
  private beforeLight: LightingInfo | null = null;
  private score = 0;
  private scoreParts = {
    visibility: 0, lighting: 0, framing: 0, angle: 0, gaze: 0, steadiness: 0,
  };
  private dynSum = { eye: 0, mouth: 0, energy: 0, smile: 0, n: 0 };
  private checks: Check[] = [];
  // expression phase — owns its own dwell; STABILITY can only complete
  // after the expression phase completes (it's an ordered check, and the
  // hold gate requires every check to pass)
  private exprStart = 0;
  private exprCalmSince = 0;
  private exprSmileBase = 0;

  private buildChecks(): Check[] {
    const yawRange: [number, number] =
      this.target === "frontal" ? [-12, 12]
      : this.target === "left" ? [-38, -14]
      : [14, 38];
    return [
      {
        id: "DISTANCE",
        test: (i) => { const w = faceW(i.boundingBox); return w >= 0.26 && w <= 0.66; },
        instruct: (i) => (faceW(i.boundingBox) < 0.26 ? "MOVE CLOSER" : "MOVE BACK"),
      },
      {
        id: "FRAMING",
        test: (i) => Math.abs(cx(i.boundingBox) - 0.5) < 0.09 && cy(i.boundingBox) > 0.32 && cy(i.boundingBox) < 0.68,
        instruct: (i) => {
          const dx = cx(i.boundingBox) - 0.5;
          if (Math.abs(dx) >= 0.09) return dx > 0 ? "MOVE SLIGHTLY LEFT" : "MOVE SLIGHTLY RIGHT";
          return cy(i.boundingBox) < 0.32 ? "LOWER CAMERA" : "RAISE CAMERA";
        },
      },
      {
        id: "ANGLE",
        test: (i) => {
          const yaw = i.pose?.yawDeg ?? 99;
          return yaw >= yawRange[0] && yaw <= yawRange[1];
        },
        instruct: (i) => {
          const yaw = i.pose?.yawDeg ?? 0;
          const mid = (yawRange[0] + yawRange[1]) / 2;
          return yaw < mid ? "TURN SLIGHTLY RIGHT" : "TURN SLIGHTLY LEFT";
        },
      },
      {
        id: "GAZE",
        test: (i) => !!i.gaze && i.gaze.label === "CENTER" && i.gaze.confidence > 0.45,
        instruct: (i) =>
          i.gaze && i.gaze.confidence < 0.3 ? "LOOK TOWARD CAMERA" : "LOOK AT CAMERA",
      },
      {
        id: "LIGHTING",
        test: (i) => lightScore01(i.lighting) > 0.62,
        instruct: (i) => {
          const lm = i.lighting;
          if (!lm) return "ADJUST POSITION";
          if (lm.mean < 0.28) return "MOVE TOWARD LIGHT";
          if (lm.contrast > 0.32 && lm.mean < 0.5) return "REDUCE BACKLIGHT";
          if (Math.hypot(lm.dirX, lm.dirY) > 0.22)
            return lm.dirX > 0 ? "TURN SLIGHTLY LEFT" : "TURN SLIGHTLY RIGHT";
          if (lm.mean > 0.82) return "REDUCE DIRECT LIGHT";
          return "ADJUST LIGHTING";
        },
      },
      {
        // expression stability — landmark dynamics only, no emotion labels.
        // Neutral is fully valid; the prompt is time-boxed and optional.
        id: "EXPR",
        test: (_i, now) => this.exprDone(now),
        instruct: (i, now) => this.exprInstruct(i, now),
      },
      {
        id: "STABILITY",
        test: (i) => i.stability > 0.55,
        instruct: () => "HOLD STILL",
      },
    ];
  }

  begin(now: number): void {
    this.target = "frontal";
    this.targetLocked = false;
    this.adoptUntil = now + 1400; // observe the user's natural pose briefly
    this.checks = this.buildChecks();
    this.startAt = now;
    this.readySince = 0;
    this.forceDone = false;
    this.firstBadAt = 0;
    this.beforeLight = null;
    this.lastLight = null;
    this.score = 0;
    this.dynSum = { eye: 0, mouth: 0, energy: 0, smile: 0, n: 0 };
    this.exprStart = 0;
    this.exprCalmSince = 0;
    this.exprSmileBase = 0;
  }

  // --- expression phase -------------------------------------------------
  // Measures facial dynamics stability — not emotion. The phase owns its
  // completion: a minimum dwell from phase start must elapse AND the face
  // must be calm-settled (or a visible smile change detected) before the
  // check passes. Graceful accept at EXPR_MAX_MS so the flow never stalls.

  private exprIdx(): number {
    return this.checks.findIndex((c) => c.id === "EXPR");
  }

  /** True while the smile blendshape has visibly risen since phase start. */
  private smileSet(d: FacialDynamics): boolean {
    return d.smile >= Math.max(0.3, this.exprSmileBase + 0.18);
  }

  private exprDone(now: number): boolean {
    const dwell = now - this.exprStart;
    if (this.exprStart === 0 || dwell < 0) return false;
    const d = this.lastInput?.dynamics;
    if (!d) return dwell > 2600;
    if (this.smileSet(d) && dwell >= 500) return true;
    const settled = this.exprCalmSince > 0 && now - this.exprCalmSince >= 550;
    return (settled && dwell >= 1300) || dwell > 2600;
  }

  private exprInstruct(i: DirectorInput, now: number): string {
    const d = i.dynamics;
    if (!d) return "RELAX YOUR FACE";
    if (this.smileSet(d)) return "EXPRESSION — SET";
    if (d.energy > 0.4 || !this.exprCalmSince) return "RELAX YOUR FACE";
    if (now - this.exprStart < 1400) return "TRY A SUBTLE SMILE";
    return "EXPRESSION — NATURAL";
  }

  update(input: DirectorInput, now: number): void {
    this.lastInput = input;
    // Adaptive target: if the user naturally holds a ¾ angle during the
    // adoption window, take that side as the internal target. The user
    // never sees "target view" terminology.
    if (!this.targetLocked && now < this.adoptUntil && input.pose) {
      const yaw = input.pose.yawDeg;
      if (yaw < -16) {
        this.target = "left";
        this.checks = this.buildChecks();
      } else if (yaw > 16) {
        this.target = "right";
        this.checks = this.buildChecks();
      }
    }
    if (!this.targetLocked && now >= this.adoptUntil) {
      this.targetLocked = true;
    }
    if (input.lighting) {
      this.lastLight = input.lighting;
      if (!this.beforeLight) this.beforeLight = input.lighting;
    }
    if (input.dynamics) {
      this.dynSum.eye += input.dynamics.eyeAperture;
      this.dynSum.mouth += input.dynamics.mouthAperture;
      this.dynSum.energy += input.dynamics.energy;
      this.dynSum.smile += input.dynamics.smile;
      this.dynSum.n++;
    }
    if (input.facePresent && !input.occluded) {
      const s = scoreFrame(input);
      this.score = s.total;
      this.scoreParts = s.parts;
    }

    // expression phase bookkeeping — starts when all upstream checks pass,
    // resets if any regresses; "calm" = low landmark-motion energy
    const ei = this.exprIdx();
    const upstreamOk =
      input.facePresent &&
      ei > 0 &&
      this.checks.slice(0, ei).every((c) => c.test(input, now));
    if (upstreamOk) {
      if (!this.exprStart) {
        this.exprStart = now;
        // baseline for detecting a visible expression *change*
        this.exprSmileBase = input.dynamics?.smile ?? 0;
      }
      const calm = (input.dynamics?.energy ?? 1) < 0.4;
      if (calm) {
        if (!this.exprCalmSince) this.exprCalmSince = now;
      } else {
        this.exprCalmSince = 0;
      }
    } else {
      this.exprStart = 0;
      this.exprCalmSince = 0;
    }

    const allOk =
      input.facePresent && this.checks.every((c) => c.test(input, now));
    if (allOk) {
      if (this.readySince === 0) this.readySince = now;
    } else {
      if (this.firstBadAt === 0) this.firstBadAt = now;
      this.readySince = 0;
    }
  }

  ui(now: number): DirectorUI {
    const inInit = now - this.startAt < INIT_MS;
    const doneFlags = this.checks.map((c) => ({ name: c.id, done: false }));
    const input = this.lastInput;
    let instruction = inInit ? "DIRECTOR MODE" : "ACQUIRING FACE";
    let phase: DirectorUI["phase"] = "guide";
    let exprProgress: number | null = null;

    if (input && input.facePresent && !inInit) {
      // first unsatisfied check drives the single instruction
      let pendingId: string | null = null;
      this.checks.forEach((c, idx) => {
        const ok = pendingId !== null ? false : c.test(input, now);
        doneFlags[idx].done = ok;
        if (!ok && pendingId === null) {
          instruction = c.instruct(input, now);
          pendingId = c.id;
        }
      });
      if (pendingId === "EXPR") {
        exprProgress = Math.min(
          Math.max((now - this.exprStart) / 1300, 0),
          1,
        );
      }
      if (pendingId === null) {
        phase = "ready";
        instruction = "HOLD STILL";
      }
    } else if (inInit) {
      phase = "init";
    }

    const held = this.readySince ? Math.min((now - this.readySince) / HOLD_MS, 1) : 0;
    if (phase === "ready" && held >= 1) instruction = "PORTRAIT READY";

    const composition =
      this.score > 0.78 ? "EXCELLENT"
      : this.score > 0.6 ? "GOOD"
      : this.score > 0.42 ? "IMPROVING" : "POOR";

    return {
      phase,
      instruction,
      checks: doneFlags,
      composition,
      holdProgress: held,
      exprProgress,
      waitSecs: this.firstBadAt && this.readySince === 0
        ? Math.floor((now - this.firstBadAt) / 1000)
        : 0,
    };
  }

  private lastInput: DirectorInput | null = null;

  isComplete(now: number): boolean {
    return this.forceDone || (this.readySince > 0 && now - this.readySince >= HOLD_MS);
  }

  forceFinish(): void {
    this.forceDone = true;
  }

  finish(video: HTMLVideoElement | null, best: BestFrameCandidate | null): DirectorResult {
    const p = this.scoreParts;
    const lab = (v: number) => (v > 0.8 ? "EXCELLENT" : v > 0.6 ? "GOOD" : v > 0.4 ? "MODERATE" : "LOW");
    const readiness: PortraitReadiness = {
      framing: lab(p.framing),
      lighting: lab(p.lighting),
      visibility: lab(p.visibility),
      angle: lab(p.angle),
      stability: lab(p.steadiness),
      occlusion: p.visibility > 0.7 ? "LOW" : "MODERATE",
      overall: this.score > 0.7 ? "PORTRAIT READY" : this.score > 0.5 ? "GOOD" : "MODERATE",
    };

    const yawRange: [number, number] =
      this.target === "frontal" ? [-12, 12]
      : this.target === "left" ? [-38, -14] : [14, 38];
    const targetLabel =
      this.target === "frontal" ? "FRONTAL" : this.target === "left" ? "LEFT 3/4" : "RIGHT 3/4";
    const achievedYaw = this.lastInput?.pose?.yawDeg ?? best?.yawDeg ?? 0;
    const achievedLabel =
      achievedYaw >= yawRange[0] && achievedYaw <= yawRange[1]
        ? targetLabel
        : Math.abs(achievedYaw) < 12 ? "FRONTAL"
          : achievedYaw < 0 ? "LEFT 3/4" : "RIGHT 3/4";

    const lightingCoach =
      this.beforeLight && this.lastLight && this.beforeLight.label !== this.lastLight.label
        ? { before: this.beforeLight.label, after: this.lastLight.label }
        : null;

    const palette = video ? analyzePalette(video) : null;
    const gazeSpread = 0; // not tracked here; aura still valid via other inputs
    const aura = deriveAura({
      palette,
      contrast: this.lastLight?.contrast ?? 0.2,
      lightingDir: this.lastLight?.dirX ?? 0,
      lightingMean: this.lastLight?.mean ?? 0.5,
      dynamicsEnergy: this.dynSum.n ? this.dynSum.energy / this.dynSum.n : 0,
      gazeSpread,
      symmetry: 70,
    });

    const dn = Math.max(1, this.dynSum.n);
    const smileMean = this.dynSum.smile / dn;
    const energyMean = this.dynSum.energy / dn;
    const expression = this.dynSum.n
      ? {
          // visual dynamics labels — no emotional inference
          label:
            smileMean < 0.25 ? "NATURAL" : smileMean < 0.55 ? "SUBTLE" : "DYNAMIC",
          stability:
            energyMean < 0.12 ? "HIGH" : energyMean < 0.3 ? "MEDIUM" : "LOW",
          motion: levelLabel(energyMean),
          eye: levelLabel(this.dynSum.eye / dn),
          lip: levelLabel(this.dynSum.mouth / dn),
        }
      : null;

    return {
      frame: best ? toBestFrameResult(best) : null,
      readiness,
      targetView: targetLabel,
      achievedView: achievedLabel,
      lightingCoach,
      aura,
      expression,
    };
  }
}

function levelLabel(v: number): string {
  return v > 0.5 ? "HIGH" : v > 0.22 ? "MEDIUM" : "LOW";
}
