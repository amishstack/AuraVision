import type { DuoSync, DuoSubject } from "@/types/vision";

/**
 * Duo synchrony — temporal similarity between two subjects' motion
 * signals over a short rolling window. Compares yaw velocity, gaze
 * drift, and landmark-motion energy. Purely motion geometry: no
 * compatibility, chemistry, or personality inference.
 */

interface Sample {
  t: number;
  yaw: number;
  gdx: number;
  gdy: number;
  energy: number;
}

const WINDOW_MS = 2400;
const MAX_SAMPLES = 72; // ~2.4s at 30 Hz

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class DuoSynchrony {
  private a: Sample[] = [];
  private b: Sample[] = [];

  reset(): void {
    this.a = [];
    this.b = [];
  }

  push(subA: DuoSubject | null, subB: DuoSubject | null, now: number): void {
    if (!subA?.present || !subB?.present) return;
    this.a.push({ t: now, yaw: subA.yawDeg, gdx: subA.gazeDx, gdy: subA.gazeDy, energy: subA.energy });
    this.b.push({ t: now, yaw: subB.yawDeg, gdx: subB.gazeDx, gdy: subB.gazeDy, energy: subB.energy });
    if (this.a.length > MAX_SAMPLES) this.a.shift();
    if (this.b.length > MAX_SAMPLES) this.b.shift();
    while (this.a.length && now - this.a[0].t > WINDOW_MS) this.a.shift();
    while (this.b.length && now - this.b[0].t > WINDOW_MS) this.b.shift();
  }

  get ready(): boolean {
    return this.a.length >= 20;
  }

  /** null until the window has enough paired samples. */
  sync(): DuoSync | null {
    if (!this.ready) return null;
    const n = Math.min(this.a.length, this.b.length);
    let head = 0, gaze = 0, motion = 0, m = 0;
    for (let i = 1; i < n; i++) {
      const A = this.a[i], Ap = this.a[i - 1];
      const B = this.b[i], Bp = this.b[i - 1];
      // yaw velocity agreement (normalized per-sample, ~33ms apart)
      const dA = A.yaw - Ap.yaw;
      const dB = B.yaw - Bp.yaw;
      head += 1 - clamp01(Math.abs(dA - dB) / 6);
      gaze += 1 - clamp01(
        (Math.abs(A.gdx - B.gdx) + Math.abs(A.gdy - B.gdy)) / 1.2,
      );
      motion += 1 - clamp01(Math.abs(A.energy - B.energy) / 0.5);
      m++;
    }
    if (!m) return null;
    head /= m;
    gaze /= m;
    motion /= m;
    return {
      head: clamp01(head),
      gaze: clamp01(gaze),
      motion: clamp01(motion),
      overall: clamp01(head * 0.4 + gaze * 0.25 + motion * 0.35),
    };
  }
}
