import type { Landmark, ProportionItem } from "@/types/vision";

/**
 * Proportional structure — measurable landmark ratios compared against
 * broad canonical-face ranges. Output is qualitative (BALANCED /
 * MODERATE / VARIABLE); these are NOT universal beauty standards.
 */

// MediaPipe indices
const L_EYE_OUTER = 33;
const R_EYE_OUTER = 263;
const NOSE_BRIDGE_TOP = 6, NOSE_BASE = 2;
const MOUTH_L = 61, MOUTH_R = 291;
const FOREHEAD = 10, BROW_CENTER = 9, CHIN = 152;
const CHEEK_L = 234, CHEEK_R = 454;
const JAW_L = 172, JAW_R = 397;

const d = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);

interface Spec {
  name: string;
  nominal: number;  // canonical-face reference ratio
  spread: number;   // half-width of the "typical" range
}

export function measureProportions(lm: Landmark[]): {
  items: ProportionItem[];
  score: number; // 0..100
  label: "BALANCED" | "MODERATE" | "VARIABLE";
} | null {
  if (lm.length <= CHEEK_R) return null;

  const faceW = d(lm[CHEEK_L], lm[CHEEK_R]);
  const faceH = d(lm[FOREHEAD], lm[CHIN]);
  const jawW = d(lm[JAW_L], lm[JAW_R]);
  if (faceW < 1e-5 || faceH < 1e-5 || jawW < 1e-5) return null;

  const eyeSpan = d(lm[L_EYE_OUTER], lm[R_EYE_OUTER]); // outer-eye spacing
  const noseLen = d(lm[NOSE_BRIDGE_TOP], lm[NOSE_BASE]);
  const mouthW = d(lm[MOUTH_L], lm[MOUTH_R]);
  const thirdTop = d(lm[FOREHEAD], lm[BROW_CENTER]);
  const thirdMid = d(lm[BROW_CENTER], lm[NOSE_BASE]);
  const thirdBot = d(lm[NOSE_BASE], lm[CHIN]);

  const specs: [Spec, number][] = [
    [{ name: "EYE SPACING / FACE WIDTH", nominal: 0.92, spread: 0.15 }, eyeSpan / faceW],
    [{ name: "NOSE LENGTH / FACE HEIGHT", nominal: 0.30, spread: 0.09 }, noseLen / faceH],
    [{ name: "MOUTH WIDTH / JAW WIDTH", nominal: 0.55, spread: 0.14 }, mouthW / jawW],
    [{ name: "UPPER / LOWER THIRDS", nominal: 1.0, spread: 0.25 }, thirdTop / Math.max(thirdBot, 1e-5)],
    [{ name: "MID / LOWER THIRDS", nominal: 1.0, spread: 0.25 }, thirdMid / Math.max(thirdBot, 1e-5)],
    [{ name: "JAW / CHEEK WIDTH", nominal: 0.86, spread: 0.14 }, jawW / faceW],
  ];

  const items: ProportionItem[] = specs.map(([s, v]) => {
    const dev = Math.abs(v - s.nominal) / s.spread;
    const label = dev < 0.55 ? "BALANCED" : dev < 1.1 ? "MODERATE" : "VARIABLE";
    return { name: s.name, ratio: Math.round(v * 100) / 100, label };
  });

  const avgDev =
    specs.reduce((acc, [s], i) => acc + Math.abs(items[i].ratio - s.nominal) / s.spread, 0) /
    specs.length;
  const score = Math.max(0, Math.min(100, Math.round(100 - avgDev * 45)));
  const label = score > 72 ? "BALANCED" : score > 45 ? "MODERATE" : "VARIABLE";
  return { items, score, label };
}
