/**
 * Adaptive inference scheduler.
 *
 * Decouples three rates:
 *   camera frame rate (video.currentTime advances)
 *   inference rate    (this scheduler decides when detectForVideo runs)
 *   render rate       (rAF — always runs; smoothing interpolates)
 *
 * Policy: run inference every new video frame, but enforce a minimum
 * interval that grows when measured inference latency approaches the
 * frame budget. On fast hardware minInterval stays ~33ms; on a slow
 * phone it relaxes toward ~80ms so rendering stays smooth. The One Euro
 * smoother bridges the gap so the overlay still animates at rAF rate.
 */

export class InferenceScheduler {
  private lastInferAt = 0;
  private lastVideoTime = -1;
  private intervalMs = 33;   // current minimum interval
  private inferences = 0;
  private windowStart = 0;
  private hz = 0;

  /** Call every rAF tick. Returns true if inference should run now. */
  shouldInfer(video: HTMLVideoElement, inferenceMsEma: number, now: number): boolean {
    // Adapt the interval once we have a latency measurement.
    if (inferenceMsEma > 0) {
      // Budget: keep inference under ~40% of wall time.
      const budget = Math.max(inferenceMsEma * 2.5, 33);
      this.intervalMs = Math.min(Math.max(budget, 30), 90);
    }

    if (video.readyState < 2) return false;
    const newFrame = video.currentTime !== this.lastVideoTime;
    const due = now - this.lastInferAt >= this.intervalMs;
    // Run when a new frame exists AND we're due — but also if no new
    // frame arrived for a while (stalled streams still get tracked).
    const stalled = now - this.lastInferAt > 200;
    if ((newFrame && due) || stalled) {
      this.lastVideoTime = video.currentTime;
      this.lastInferAt = now;
      this.inferences++;
      return true;
    }
    return false;
  }

  /** Actual inference rate, computed over a sliding 1s window. */
  inferenceHz(now: number): number {
    if (now - this.windowStart >= 1000) {
      this.hz = this.inferences / Math.max((now - this.windowStart) / 1000, 0.001);
      this.inferences = 0;
      this.windowStart = now;
    }
    return this.hz;
  }
}
