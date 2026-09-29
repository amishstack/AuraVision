import type { TimelineSample } from "@/types/vision";

/**
 * Motion timeline recorder — bounded time-series of derived numeric
 * measurements only (no camera frames, no pixels). ~12 Hz sample rate,
 * ~90 s cap. In-memory; cleared when a new Free Lab session starts.
 */

const SAMPLE_MS = 80; // ~12.5 Hz
const MAX_SAMPLES = 1100;

export class TimelineRecorder {
  samples: TimelineSample[] = [];
  private lastT = -Infinity;

  reset(): void {
    this.samples = [];
    this.lastT = -Infinity;
  }

  /** Push a sample if enough time has elapsed since the last one. */
  push(now: number, s: Omit<TimelineSample, "t">): void {
    if (now - this.lastT < SAMPLE_MS) return;
    this.lastT = now;
    this.samples.push({ t: now, ...s });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  get length(): number {
    return this.samples.length;
  }
}

export interface TimelineSummary {
  durationMs: number;
  activeMs: number;
  peakRegion: string;
  eventCount: number;
  sufficient: boolean;
}

const ACTIVE_THRESHOLD = 0.08;

export function summarizeTimeline(samples: TimelineSample[]): TimelineSummary {
  const durationMs =
    samples.length > 1 ? samples[samples.length - 1].t - samples[0].t : 0;
  const dt = samples.length > 1 ? durationMs / (samples.length - 1) : SAMPLE_MS;
  let activeMs = 0;
  let eventCount = 0;
  const regionActive: Record<string, number> = {};
  const regionPeak: Record<string, number> = {};
  for (const s of samples) {
    if (s.motion > ACTIVE_THRESHOLD) activeMs += dt;
    eventCount += s.events.length;
    for (const k of Object.keys(s.regions) as (keyof TimelineSample["regions"])[]) {
      const v = s.regions[k];
      regionActive[k] = (regionActive[k] ?? 0) + (v > ACTIVE_THRESHOLD ? dt : 0);
      if (v > (regionPeak[k] ?? 0)) regionPeak[k] = v;
    }
  }
  const peakRegion =
    Object.entries(regionActive).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  return {
    durationMs,
    activeMs,
    peakRegion: peakRegion.toUpperCase(),
    eventCount,
    sufficient: durationMs > 2000 && samples.length > 20 && activeMs > 500,
  };
}

/** Per-region stats for the tapped-detail readout. */
export function regionDetail(
  samples: TimelineSample[],
  region: keyof TimelineSample["regions"],
): { peak: number; activeMs: number; events: number } {
  let peak = 0;
  let activeMs = 0;
  let events = 0;
  const dt =
    samples.length > 1
      ? (samples[samples.length - 1].t - samples[0].t) / (samples.length - 1)
      : SAMPLE_MS;
  const key = region.toUpperCase();
  for (const s of samples) {
    const v = s.regions[region];
    if (v > peak) peak = v;
    if (v > ACTIVE_THRESHOLD) activeMs += dt;
    if (
      s.events.some(
        (e) =>
          e.includes(key) ||
          (region === "mouth" && e === "MOUTH RESPONSE") ||
          (region === "brow" && e === "BROW RESPONSE"),
      )
    )
      events++;
  }
  return { peak, activeMs, events };
}
