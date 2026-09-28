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
  test: (i: DirectorInput) => boolean;
  instruct: (i: DirectorInput) => string;
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
  private dynSum = { eye: 0, mouth: 0, energy: 0, n: 0 };
  private checks: Check[] = [];

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
        id: "STABILITY",
        test: (i) => i.stability > 0.55,
        instruct: () => "HOLD STILL",
      },
    ];
  }

  begin(now: number, target: DirectorTarget): void {
    this.target = target;
    this.checks = this.buildChecks();
    this.startAt = now;
    this.readySince = 0;
    this.forceDone = false;
    this.firstBadAt = 0;
    this.beforeLight = null;
    this.lastLight = null;
    this.score = 0;
    this.dynSum = { eye: 0, mouth: 0, energy: 0, n: 0 };
  }

  update(input: DirectorInput, now: number): void {
    this.lastInput = input;
    if (input.lighting) {
      this.lastLight = input.lighting;
      if (!this.beforeLight) this.beforeLight = input.lighting;
    }
    if (input.dynamics) {
      this.dynSum.eye += input.dynamics.eyeAperture;
      this.dynSum.mouth += input.dynamics.mouthAperture;
      this.dynSum.energy += input.dynamics.energy;
      this.dynSum.n++;
    }
    if (input.facePresent && !input.occluded) {
      const s = scoreFrame(input);
      this.score = s.total;
      this.scoreParts = s.parts;
    }

    const allOk =
      input.facePresent && this.checks.every((c) => c.test(input));
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

    if (input && input.facePresent && !inInit) {
      // first unsatisfied check drives the single instruction
      let pending = false;
      this.checks.forEach((c, idx) => {
        const ok = pending ? false : c.test(input);
        doneFlags[idx].done = ok;
        if (!ok && !pending) {
          instruction = c.instruct(input);
          pending = true;
        }
      });
      if (!pending) {
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
    const expression = this.dynSum.n
      ? {
          motion: levelLabel(this.dynSum.energy / dn),
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
