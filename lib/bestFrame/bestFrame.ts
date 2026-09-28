import { scoreFrame, type FrameScore, type FrameScoreInput } from "./scoring";
import type { BestFrameResult, Landmark } from "@/types/vision";

/**
 * Best Frame engine — continuously evaluates candidate frames while a
 * face is tracked, keeping the top-N in memory as small JPEG thumbnails
 * of the face region. Everything stays in memory; nothing is uploaded.
 */

export interface BestFrameCandidate {
  score: FrameScore;
  /** small JPEG data-URL of the face region (~200px tall) */
  image: string;
  /** landmark copy aligned with the captured image */
  landmarks: Landmark[];
  /** capture crop in normalized coords (for geometry overlay mapping) */
  crop: { x: number; y: number; w: number; h: number };
  yawDeg: number;
}

const KEEP = 3;
const DEFAULT_INTERVAL_MS = 500;
const THUMB_H = 360;
const HISTORY_KEEP = 9;

export interface FrameHistoryEntry {
  quality: number; // 0..100
  isBest: boolean;
}

export function toBestFrameResult(c: BestFrameCandidate): BestFrameResult {
  return {
    image: c.image,
    landmarks: c.landmarks,
    crop: c.crop,
    parts: {
      lighting: Math.round(c.score.parts.lighting * 100),
      framing: Math.round(c.score.parts.framing * 100),
      angle: Math.round(c.score.parts.angle * 100),
      visibility: Math.round(c.score.parts.visibility * 100),
      gaze: Math.round(c.score.parts.gaze * 100),
      steadiness: Math.round(c.score.parts.steadiness * 100),
    },
    angleLabel:
      Math.abs(c.yawDeg) < 12
        ? "FRONTAL"
        : c.yawDeg < 0
          ? "LEFT 3/4"
          : "RIGHT 3/4",
  };
}

export class BestFrameEngine {
  private top: BestFrameCandidate[] = [];
  private history: FrameHistoryEntry[] = [];
  private lastEval = 0;
  private newBestAt = 0;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private evaluated = 0;

  update(
    video: HTMLVideoElement,
    input: FrameScoreInput & { landmarks: Landmark[] | null; mirrored: boolean },
    now: number,
    intervalMs: number = DEFAULT_INTERVAL_MS,
  ): void {
    if (now - this.lastEval < intervalMs) return;
    if (!input.landmarks || !input.boundingBox || input.occluded) return;
    if (video.videoWidth === 0) return;
    this.lastEval = now;
    this.evaluated++;

    const score = scoreFrame(input);
    // ignore weak candidates early
    if (score.total < 0.35) return;

    const bb = input.boundingBox;
    const ex = bb.x - bb.w * 0.22;
    const ey = bb.y - bb.h * 0.28;
    const ew = bb.w * 1.44;
    const eh = bb.h * 1.56;
    const cx = Math.max(0, ex);
    const cy = Math.max(0, ey);
    const cw = Math.min(1, ex + ew) - cx;
    const ch = Math.min(1, ey + eh) - cy;

    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
      this.ctx = this.canvas.getContext("2d");
    }
    if (!this.ctx) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const aspect = cw * vw / (ch * vh);
    const th = THUMB_H;
    const tw = Math.round(th * aspect);
    this.canvas.width = tw;
    this.canvas.height = th;

    const ctx = this.ctx;
    ctx.save();
    if (input.mirrored) {
      ctx.translate(tw, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, cx * vw, cy * vh, cw * vw, ch * vh, 0, 0, tw, th);
    ctx.restore();

    const cand: BestFrameCandidate = {
      score,
      image: this.canvas.toDataURL("image/jpeg", 0.72),
      landmarks: input.landmarks.map((p) => ({ ...p })),
      crop: { x: cx, y: cy, w: cw, h: ch },
      yawDeg: input.pose?.yawDeg ?? 0,
    };

    const prevBest = this.top[0]?.score.total ?? -1;
    this.top.push(cand);
    this.top.sort((a, b) => b.score.total - a.score.total);
    if (this.top.length > KEEP) this.top.length = KEEP;
    if (score.total > prevBest) this.newBestAt = now;

    this.history.push({
      quality: Math.round(score.total * 100),
      isBest: this.top[0] === cand,
    });
    if (this.history.length > HISTORY_KEEP) this.history.shift();
    // re-mark: best may have changed
    const bestScore = this.top[0].score.total;
    for (const h of this.history) h.isBest = h.quality === Math.round(bestScore * 100);
  }

  evaluatedCount(): number {
    return this.evaluated;
  }

  best(): BestFrameCandidate | null {
    return this.top[0] ?? null;
  }

  candidates(): readonly BestFrameCandidate[] {
    return this.top;
  }

  historyEntries(): readonly FrameHistoryEntry[] {
    return this.history;
  }

  lastNewBestAt(): number {
    return this.newBestAt;
  }

  bestQualityPct(): number {
    return this.top[0] ? Math.round(this.top[0].score.total * 100) : 0;
  }

  reset(): void {
    this.top = [];
    this.history = [];
    this.evaluated = 0;
    this.lastEval = 0;
    this.newBestAt = 0;
  }
}
