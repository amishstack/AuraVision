/**
 * Visual Vibe — playful, deterministic descriptors derived from
 * observable visual characteristics. Explicitly entertainment, not
 * personality inference.
 */

interface VibeInput {
  symmetry: number;        // 0..100
  lightingMean: number;    // 0..1
  lightingContrast: number;// 0..1
  dynamicsEnergy: number;  // 0..1
  warm: number;            // -1..1 palette warmth
  smile: number;           // 0..1 mean smile blendshape
}

export function deriveVibe(i: VibeInput): string[] {
  const scored: [string, number][] = [
    ["ELEGANT", i.symmetry * 0.5 + (1 - i.lightingContrast) * 25 + i.lightingMean * 15],
    ["BOLD", i.lightingContrast * 60 + i.symmetry * 0.25],
    ["MYSTERIOUS", (1 - i.lightingMean) * 55 + i.lightingContrast * 20],
    ["PLAYFUL", i.smile * 45 + i.dynamicsEnergy * 30 + Math.max(i.warm, 0) * 15],
    ["EXPRESSIVE", i.dynamicsEnergy * 65 + i.smile * 20],
    ["MINIMAL", (1 - i.dynamicsEnergy) * 35 + i.symmetry * 0.35 + (1 - Math.abs(i.warm)) * 15],
  ];
  return scored
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name]) => name);
}
