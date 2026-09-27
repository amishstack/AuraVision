/**
 * One Euro filter — adaptive low-pass filter standard for jitter removal
 * in real-time landmark tracking.
 *
 * At low velocity it smooths aggressively (kills jitter); at high velocity
 * the cutoff rises so fast motion stays responsive.
 *
 * Reference: Casiez, Roussel, Vogel — "1€ Filter" (CHI 2012).
 */

class LowPass {
  private y: number | null = null;
  private s: number | null = null;

  filter(x: number, alpha: number): number {
    const s = this.s === null ? x : this.s + alpha * (x - this.s);
    this.s = s;
    return s;
  }

  hasLastValue(): boolean {
    return this.s !== null;
  }

  lastValue(): number {
    return this.s ?? 0;
  }
}

export class OneEuroFilter {
  private x = new LowPass();
  private dx = new LowPass();
  private lastTime: number | null = null;

  /**
   * @param minCutoff Hz — lower = smoother but more lag. ~1.0–1.5 for faces.
   * @param beta      cutoff increase per unit of velocity (higher = less lag on fast moves)
   * @param dCutoff   Hz — cutoff for the derivative signal
   */
  constructor(
    private readonly minCutoff = 1.2,
    private readonly beta = 0.6,
    private readonly dCutoff = 1.0,
  ) {}

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, timeSeconds: number): number {
    const dt =
      this.lastTime === null
        ? 1 / 60
        : Math.max(timeSeconds - this.lastTime, 1e-4);
    this.lastTime = timeSeconds;

    const dValue = this.x.hasLastValue()
      ? (value - this.x.lastValue()) / dt
      : 0;
    const edValue = this.dx.filter(dValue, this.alpha(this.dCutoff, dt));

    const cutoff = this.minCutoff + this.beta * Math.abs(edValue);
    return this.x.filter(value, this.alpha(cutoff, dt));
  }

  reset(): void {
    this.x = new LowPass();
    this.dx = new LowPass();
    this.lastTime = null;
  }
}
