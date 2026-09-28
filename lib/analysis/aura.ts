import type { PaletteReport } from "@/types/vision";

/**
 * Aura Profile — a playful, deterministic visual interpretation built
 * from palette, contrast, lighting direction, motion and gaze
 * distribution. Explicitly interpretive — visual qualities only.
 */

export interface AuraInput {
  palette: PaletteReport | null;
  contrast: number;       // 0..1
  lightingDir: number;    // -1..1 horizontal key direction magnitude
  lightingMean: number;   // 0..1
  dynamicsEnergy: number; // 0..1
  gazeSpread: number;     // 0..1 how much gaze moved off center
  symmetry: number;       // 0..100
}

export function deriveAura(i: AuraInput): string[] {
  const warm = i.palette?.temperature === "WARM" ? 1 : i.palette?.temperature === "COOL" ? -1 : 0;
  const colorful = i.palette ? (i.palette.temperature === "NEUTRAL" ? 0.4 : 0.7) : 0.5;

  const scored: [string, number][] = [
    ["WARM", Math.max(0, warm) * 55 + i.lightingMean * 15],
    ["COOL", Math.max(0, -warm) * 55 + (1 - i.lightingMean) * 12],
    ["MONOCHROME", (1 - colorful) * 50 + (1 - i.contrast) * 15],
    ["ELECTRIC", i.contrast * 55 + i.dynamicsEnergy * 25],
    ["SOFT", (1 - i.contrast) * 40 + Math.max(0, warm) * 20],
    ["BOLD", i.contrast * 45 + i.symmetry * 0.2],
    ["CINEMATIC", Math.abs(i.lightingDir) * 40 + i.contrast * 25 + (1 - i.lightingMean) * 12],
    ["DYNAMIC", i.dynamicsEnergy * 55 + i.gazeSpread * 20],
    ["BALANCED", i.symmetry * 0.4 + (1 - Math.abs(warm)) * 20],
    ["MINIMAL", (1 - i.dynamicsEnergy) * 30 + (1 - i.contrast) * 25],
    ["EXPRESSIVE", i.gazeSpread * 45 + i.dynamicsEnergy * 30],
  ];
  return scored
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([n]) => n);
}
