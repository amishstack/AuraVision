/**
 * Visual Presence — qualitative descriptors derived strictly from
 * measurable camera-visible signals. Structural interpretation, not
 * personality inference.
 */

export interface PresenceInput {
  stabilityPct: number;    // 0..100
  symmetry: number;        // 0..100
  contrast: number;        // 0..1
  lightingMean: number;    // 0..1
  dynamicsEnergy: number;  // 0..1
  gazeStability: number;   // 0..1 confidence mean
  framing: number;         // 0..100
  occludedFraction: number; // 0..1
}

export interface PresenceResult {
  descriptors: string[];
  /** the measurable signals behind each descriptor, for honesty */
  basis: string[];
}

export function derivePresence(i: PresenceInput): PresenceResult {
  const picks: { name: string; basis: string; score: number }[] = [
    { name: "CLEAN", basis: "high visibility, low occlusion", score: (1 - i.occludedFraction) * 50 + i.stabilityPct * 0.35 },
    { name: "STRUCTURED", basis: "geometric balance", score: i.symmetry * 0.7 },
    { name: "CALM", basis: "low motion energy", score: (1 - i.dynamicsEnergy) * 55 },
    { name: "DYNAMIC", basis: "high temporal motion", score: i.dynamicsEnergy * 65 },
    { name: "HIGH-CONTRAST", basis: "strong luminance range", score: i.contrast * 130 },
    { name: "SOFT", basis: "gentle contrast + diffuse light", score: (1 - i.contrast) * 45 + i.lightingMean * 15 },
    { name: "BALANCED", basis: "centered framing", score: i.framing * 0.55 },
    { name: "CINEMATIC", basis: "directional illumination + stable geometry", score: i.contrast * 35 + i.stabilityPct * 0.3 + (i.lightingMean < 0.55 ? 12 : 0) },
    { name: "STEADY", basis: "high gaze + head stability", score: i.gazeStability * 45 + i.stabilityPct * 0.25 },
  ];
  picks.sort((a, b) => b.score - a.score);
  const top = picks.slice(0, 3);
  return {
    descriptors: top.map((p) => p.name),
    basis: top.map((p) => p.basis),
  };
}
