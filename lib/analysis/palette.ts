import type { PaletteReport } from "@/types/vision";

/**
 * Visual palette — dominant color extraction from a heavily downscaled
 * frame. 4-bit-per-channel histogram → top swatches + warm/cool and
 * contrast classification. Descriptive only; not a color-season claim.
 */

const S_W = 32;
const S_H = 20;

export function analyzePalette(video: HTMLVideoElement): PaletteReport | null {
  if (video.videoWidth === 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = S_W;
  canvas.height = S_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, S_W, S_H);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, S_W, S_H).data;
  } catch {
    return null;
  }

  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  let lumSum = 0;
  let warmSum = 0;
  const n = S_W * S_H;
  const lums = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    lums[i] = lum;
    lumSum += lum;
    warmSum += (r - b) / 255;
    // quantize to 4 bits/channel
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bk = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bk.count++;
    bk.r += r;
    bk.g += g;
    bk.b += b;
    buckets.set(key, bk);
  }

  const top = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((bk) => {
      const r = Math.round(bk.r / bk.count);
      const g = Math.round(bk.g / bk.count);
      const b = Math.round(bk.b / bk.count);
      return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
    });

  const mean = lumSum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) varSum += (lums[i] - mean) ** 2;
  const contrast = Math.sqrt(varSum / n);

  const warm = warmSum / n;
  return {
    colors: top,
    temperature: warm > 0.04 ? "WARM" : warm < -0.04 ? "COOL" : "NEUTRAL",
    contrastLabel:
      contrast > 0.22 ? "HIGH CONTRAST" : contrast < 0.1 ? "LOW CONTRAST" : "BALANCED",
  };
}
