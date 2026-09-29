import type {
  Landmark,
  MotionSignatureData,
  TimelineSample,
} from "@/types/vision";
import { summarizeTimeline } from "./timeline";

/**
 * Motion signature builder — deterministic derivation from the recorded
 * timeline. Produces the data behind the radial fingerprint hero; no
 * generation, no inference, no personality claims.
 */

const REGIONS = ["brow", "eyes", "nose", "mouth", "cheeks", "jaw"] as const;
const SERIES_LEN = 160;
const ACTIVE_THRESHOLD = 0.08;

export function buildMotionSignature(
  samples: TimelineSample[],
  baseline: Landmark[] | null,
): MotionSignatureData | null {
  if (samples.length < 10) return null;
  const sum = summarizeTimeline(samples);
  if (!sum.sufficient) return null;

  const regionPeak = {} as MotionSignatureData["regionPeak"];
  const regionMean = {} as MotionSignatureData["regionMean"];
  for (const r of REGIONS) {
    let pk = 0;
    let acc = 0;
    for (const s of samples) {
      const v = s.regions[r];
      if (v > pk) pk = v;
      acc += v;
    }
    regionPeak[r] = pk;
    regionMean[r] = acc / samples.length;
  }

  // rhythm — coefficient of variation of inter-active-gap durations
  const gaps: number[] = [];
  let lastActive = -1;
  for (const s of samples) {
    if (s.motion > ACTIVE_THRESHOLD) {
      if (lastActive >= 0) gaps.push(s.t - lastActive);
      lastActive = s.t;
    }
  }
  const rhythm =
    gaps.length < 2
      ? "CONTINUOUS"
      : (() => {
          const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
          const sd = Math.sqrt(
            gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length,
          );
          const cv = mean > 0 ? sd / mean : 0;
          return cv > 0.9 ? "BURSTY" : cv > 0.4 ? "INTERMITTENT" : "CONTINUOUS";
        })();

  // decimated overall-motion waveform for the hero/temporal signature
  const series = new Float32Array(SERIES_LEN);
  const step = samples.length / SERIES_LEN;
  for (let i = 0; i < SERIES_LEN; i++) {
    const idx = Math.min(samples.length - 1, Math.floor(i * step));
    series[i] = samples[idx].motion;
  }

  return {
    regionPeak,
    regionMean,
    peakRegion: sum.peakRegion,
    eventCount: sum.eventCount,
    durationMs: sum.durationMs,
    activeMs: sum.activeMs,
    rhythm,
    series,
    baseline,
  };
}

/** Qualitative activity label from a peak value — derived thresholds only. */
export function activityLabel(v: number): string {
  if (v > 0.65) return "HIGH ACTIVITY";
  if (v > 0.35) return "ACTIVE";
  if (v > 0.15) return "MODERATE";
  return "LOW";
}
