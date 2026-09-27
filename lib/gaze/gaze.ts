import type { GazeEstimate, GazeLabel, Landmark } from "@/types/vision";

/**
 * Experimental monocular gaze estimation.
 *
 * Uses iris-center displacement inside each eye's corner bounding region.
 * This is NOT precise eye tracking — it is a directional estimate with an
 * honest confidence derived from eye aperture (closed/squinting eyes give
 * unreliable iris positions).
 *
 * MediaPipe 478-point indices:
 *   left iris center 468, right iris center 473
 *   left eye corners 33 (outer) / 133 (inner), lids 159 / 145
 *   right eye corners 263 (outer) / 362 (inner), lids 386 / 374
 */

const L_IRIS = 468;
const R_IRIS = 473;
const L_OUTER = 33, L_INNER = 133, L_TOP = 159, L_BOT = 145;
const R_OUTER = 263, R_INNER = 362, R_TOP = 386, R_BOT = 374;

interface EyeGaze { dx: number; dy: number; aperture: number }

function eyeGaze(
  lm: Landmark[],
  iris: number, inner: number, outer: number, top: number, bot: number,
): EyeGaze | null {
  if (lm.length <= Math.max(iris, inner, outer, top, bot)) return null;
  const i = lm[iris], a = lm[inner], b = lm[outer], t = lm[top], bt = lm[bot];

  const w = Math.hypot(b.x - a.x, b.y - a.y);
  const h = Math.hypot(t.x - bt.x, t.y - bt.y);
  if (w < 1e-5 || h < 1e-6) return null;

  const cx = (a.x + b.x) / 2;
  const cy = (t.y + bt.y) / 2;
  return {
    dx: (i.x - cx) / (w / 2),   // -1..+1 at corners
    dy: (i.y - cy) / (h / 2),   // -1..+1 at lids
    aperture: h / w,            // ~0.3 open, ~0 closed
  };
}

function label(dx: number, dy: number, conf: number): GazeLabel {
  if (conf < 0.35) return "LOW CONFIDENCE";
  const horiz = dx < -0.35 ? "LEFT" : dx > 0.35 ? "RIGHT" : "";
  const vert = dy < -0.45 ? "UP" : dy > 0.45 ? "DOWN" : "";
  if (vert === "UP") {
    if (horiz === "LEFT") return "UP-LEFT";
    if (horiz === "RIGHT") return "UP-RIGHT";
    return "UP";
  }
  if (vert === "DOWN") return "DOWN";
  return horiz === "" ? "CENTER" : (horiz as GazeLabel);
}

export function estimateGaze(
  lm: Landmark[] | null,
  mirrored = false,
): GazeEstimate | null {
  if (!lm) return null;
  const l = eyeGaze(lm, L_IRIS, L_INNER, L_OUTER, L_TOP, L_BOT);
  const r = eyeGaze(lm, R_IRIS, R_INNER, R_OUTER, R_TOP, R_BOT);
  if (!l && !r) return null;

  // Weight each eye by its aperture — squinting eyes contribute less.
  const lw = l ? clamp01(l.aperture / 0.3) : 0;
  const rw = r ? clamp01(r.aperture / 0.3) : 0;
  const total = lw + rw;
  if (total < 1e-3) {
    return { dx: 0, dy: 0, confidence: 0, label: "LOW CONFIDENCE" };
  }

  let dx = ((l?.dx ?? 0) * lw + (r?.dx ?? 0) * rw) / total;
  const dy = ((l?.dy ?? 0) * lw + (r?.dy ?? 0) * rw) / total;
  // Mirrored preview: reported LEFT/RIGHT should match what the viewer
  // sees on screen, which is flipped relative to image coordinates.
  if (mirrored) dx = -dx;
  const confidence = clamp01(total / 2);
  return { dx, dy, confidence, label: label(dx, dy, confidence) };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
