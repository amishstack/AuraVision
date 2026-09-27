import type { LightingInfo } from "@/types/vision";

/**
 * Lightweight illumination analysis — samples the video frame at very low
 * resolution (~32×24) a few times per second and derives:
 *   - mean luminance
 *   - luminance standard deviation (contrast proxy)
 *   - horizontal/vertical brightness gradient → dominant light direction
 *
 * This is deliberately coarse. It is an "illumination field" heuristic,
 * not photometric calibration.
 */

const S_W = 32;
const S_H = 24;

export class LightingAnalyzer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private lastSample = 0;
  private readonly intervalMs: number;
  private ema: LightingInfo | null = null;

  constructor(intervalMs = 400) {
    this.intervalMs = intervalMs;
  }

  update(video: HTMLVideoElement, now: number): LightingInfo | null {
    if (now - this.lastSample < this.intervalMs) return this.ema;
    this.lastSample = now;

    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = S_W;
      this.canvas.height = S_H;
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    }
    const ctx = this.ctx;
    if (!ctx || video.videoWidth === 0) return this.ema;

    ctx.drawImage(video, 0, 0, S_W, S_H);
    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, S_W, S_H).data;
    } catch {
      return this.ema;
    }

    const n = S_W * S_H;
    const lum = new Float32Array(n);
    let sum = 0, gx = 0, gy = 0;
    for (let y = 0; y < S_H; y++) {
      for (let x = 0; x < S_W; x++) {
        const i = (y * S_W + x) * 4;
        const l = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
        const idx = y * S_W + x;
        lum[idx] = l;
        sum += l;
        // gradient-weighted position: +x means brighter on the right
        gx += l * ((x / (S_W - 1)) * 2 - 1);
        gy += l * ((y / (S_H - 1)) * 2 - 1);
      }
    }
    const mean = sum / n;
    let varSum = 0;
    for (let i = 0; i < n; i++) {
      const dv = lum[i] - mean;
      varSum += dv * dv;
    }
    const contrast = Math.sqrt(varSum / n);
    const dirX = gx / n / Math.max(mean, 1e-3);
    const dirY = gy / n / Math.max(mean, 1e-3);

    const sample: LightingInfo = {
      mean,
      contrast: Math.min(contrast * 2.5, 1),
      dirX: clamp(dirX * 3, -1, 1),
      dirY: clamp(dirY * 3, -1, 1),
      label: "",
    };
    sample.label = labelFor(sample);

    // Temporal EMA so the UI doesn't flicker between labels.
    if (!this.ema) {
      this.ema = sample;
    } else {
      const a = 0.25;
      this.ema = {
        mean: this.ema.mean + a * (sample.mean - this.ema.mean),
        contrast: this.ema.contrast + a * (sample.contrast - this.ema.contrast),
        dirX: this.ema.dirX + a * (sample.dirX - this.ema.dirX),
        dirY: this.ema.dirY + a * (sample.dirY - this.ema.dirY),
        label: "",
      };
      this.ema.label = labelFor(this.ema);
    }
    return this.ema;
  }

  reset(): void {
    this.ema = null;
  }
}

function labelFor(l: LightingInfo): string {
  if (l.mean < 0.12) return "LOW LIGHT";
  const directional = Math.hypot(l.dirX, l.dirY) > 0.18;
  if (!directional) return l.mean > 0.75 ? "BRIGHT — DIFFUSE" : "DIFFUSE";
  const side =
    Math.abs(l.dirX) > Math.abs(l.dirY)
      ? l.dirX > 0 ? "RIGHT-KEY" : "LEFT-KEY"
      : l.dirY > 0 ? "LOW-KEY" : "TOP-KEY";
  return `${side} DIRECTIONAL`;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
