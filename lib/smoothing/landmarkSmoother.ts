import { OneEuroFilter } from "./oneEuro";
import type { Landmark } from "@/types/vision";

/**
 * Per-landmark temporal smoothing. Each landmark gets an independent
 * One Euro filter on x and y (z smoothed with a fixed cutoff — it is
 * only used for subtle depth shading).
 *
 * Filters are lazily created so this adapts to any landmark count.
 */
export class LandmarkSmoother {
  private fx: OneEuroFilter[] = [];
  private fy: OneEuroFilter[] = [];
  private fz: OneEuroFilter[] = [];
  private smoothed: Landmark[] = [];
  private framesSinceReset = 0;

  constructor(
    private readonly minCutoff = 1.2,
    private readonly beta = 0.6,
  ) {}

  update(raw: Landmark[], timeSeconds: number): Landmark[] {
    while (this.fx.length < raw.length) {
      this.fx.push(new OneEuroFilter(this.minCutoff, this.beta));
      this.fy.push(new OneEuroFilter(this.minCutoff, this.beta));
      this.fz.push(new OneEuroFilter(0.9, 0.3));
      this.smoothed.push({ x: 0, y: 0, z: 0 });
    }

    for (let i = 0; i < raw.length; i++) {
      const s = this.smoothed[i];
      // First frames after (re)acquisition: snap instead of sweeping in
      // from a stale position — avoids a visible "fly-in" artifact.
      if (this.framesSinceReset < 2) {
        s.x = raw[i].x;
        s.y = raw[i].y;
        s.z = raw[i].z;
      } else {
        s.x = this.fx[i].filter(raw[i].x, timeSeconds);
        s.y = this.fy[i].filter(raw[i].y, timeSeconds);
        s.z = this.fz[i].filter(raw[i].z, timeSeconds);
      }
    }
    this.framesSinceReset++;
    return this.smoothed;
  }

  /** Call when the face is lost so next acquisition starts clean. */
  reset(): void {
    for (const f of this.fx) f.reset();
    for (const f of this.fy) f.reset();
    for (const f of this.fz) f.reset();
    this.framesSinceReset = 0;
  }
}
