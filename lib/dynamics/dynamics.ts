import type { FacialDynamics, Landmark } from "@/types/vision";

/**
 * Facial dynamics — temporal landmark motion analysis, not emotion
 * classification. Measures apertures, spreads, and the velocity energy of
 * the landmark field. No psychological inference is performed.
 */

// MediaPipe indices
const L_TOP = 159, L_BOT = 145, L_OUTER = 33, L_INNER = 133;
const R_TOP = 386, R_BOT = 374, R_OUTER = 263, R_INNER = 362;
const L_BROW = 105, R_BROW = 334;           // inner-lower brow region
const LIP_TOP = 13, LIP_BOT = 14;
const MOUTH_L = 61, MOUTH_R = 291;
const FOREHEAD = 10, CHIN = 152;
const CHEEK_L = 234, CHEEK_R = 454;

const d = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);

export interface BlendshapeSignals {
  blinkLeft: number;
  blinkRight: number;
  smile: number;
  jawOpen: number;
}

export function measureDynamics(
  lm: Landmark[],
  blend: BlendshapeSignals | null,
  prevEnergy: number,
): FacialDynamics | null {
  if (lm.length <= CHEEK_R) return null;

  const faceW = d(lm[CHEEK_L], lm[CHEEK_R]);
  const faceH = d(lm[FOREHEAD], lm[CHIN]);
  if (faceW < 1e-5 || faceH < 1e-5) return null;

  const lEyeW = d(lm[L_OUTER], lm[L_INNER]);
  const rEyeW = d(lm[R_OUTER], lm[R_INNER]);
  const lAp = d(lm[L_TOP], lm[L_BOT]) / Math.max(lEyeW, 1e-5);
  const rAp = d(lm[R_TOP], lm[R_BOT]) / Math.max(rEyeW, 1e-5);

  const lBrow = d(lm[L_BROW], lm[L_TOP]) / lEyeW;
  const rBrow = d(lm[R_BROW], lm[R_TOP]) / rEyeW;

  return {
    eyeAperture: clamp01(((lAp + rAp) / 2) / 0.35),
    mouthAperture: clamp01(d(lm[LIP_TOP], lm[LIP_BOT]) / (faceH * 0.12)),
    browRaise: clamp01(((lBrow + rBrow) / 2 - 0.5) / 0.5),
    lipSpread: clamp01(d(lm[MOUTH_L], lm[MOUTH_R]) / faceW),
    jawOpen: blend?.jawOpen ?? 0,
    blinkLeft: blend?.blinkLeft ?? 0,
    blinkRight: blend?.blinkRight ?? 0,
    smile: blend?.smile ?? 0,
    energy: prevEnergy,
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
