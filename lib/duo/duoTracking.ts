import type { DuoSubject, Landmark } from "@/types/vision";
import { LandmarkSmoother } from "@/lib/smoothing/landmarkSmoother";
import { boundingBoxOf } from "@/lib/geometry/mesh";
import { poseFromLandmarks } from "@/lib/geometry/pose";
import { estimateGaze } from "@/lib/gaze/gaze";

/**
 * Duo tracking — maintains stable Subject A / Subject B identity across
 * frames using centroid continuity. A detection claims a slot only if its
 * centroid stays within a radius of the slot's last position; new faces
 * fill empty slots. This keeps A/B labels consistent even when subjects
 * move, cross, or one briefly leaves the frame.
 */

export interface DuoDetection {
  landmarks: Landmark[];
}

interface Slot {
  cx: number;
  cy: number;
  missed: number;
  prevLm: Landmark[] | null;
  energyEma: number;
}

const CLAIM_RADIUS = 0.28; // normalized centroid distance
const MISS_LIMIT = 12;     // frames before a slot is released

export class DuoTracker {
  private slots: (Slot | null)[] = [null, null];
  private smoothers = [
    new LandmarkSmoother(1.2, 0.6),
    new LandmarkSmoother(1.2, 0.6),
  ];

  reset(): void {
    this.slots = [null, null];
    this.smoothers[0].reset();
    this.smoothers[1].reset();
  }

  /**
   * Update from the current detections (0–2 faces, raw normalized
   * landmarks). Returns the subjects for rendering/synchrony.
   */
  update(
    faces: DuoDetection[],
    mirrored: boolean,
    now: number,
  ): (DuoSubject | null)[] {
    const nowS = now / 1000;

    // detection centroids
    const det = faces.slice(0, 2).map((f) => {
      const bb = boundingBoxOf(f.landmarks);
      return {
        f,
        bb,
        cx: bb ? bb.x + bb.w / 2 : 0.5,
        cy: bb ? bb.y + bb.h / 2 : 0.5,
      };
    });

    // slots claim nearest detections (temporal continuity, not x-sort)
    const used = new Set<number>();
    const assigned: (number | null)[] = [null, null];
    for (let s = 0; s < 2; s++) {
      const slot = this.slots[s];
      if (!slot) continue;
      let bi = -1;
      let bd = CLAIM_RADIUS;
      det.forEach((d, i) => {
        if (used.has(i)) return;
        const dd = Math.hypot(d.cx - slot.cx, d.cy - slot.cy);
        if (dd < bd) {
          bd = dd;
          bi = i;
        }
      });
      if (bi >= 0) {
        assigned[s] = bi;
        used.add(bi);
      }
    }
    // unclaimed detections fill empty slots
    det.forEach((_d, i) => {
      if (used.has(i)) return;
      const s =
        assigned[0] === null ? 0 : assigned[1] === null ? 1 : -1;
      if (s >= 0) {
        assigned[s] = i;
        used.add(i);
      }
    });

    const out: (DuoSubject | null)[] = [null, null];
    for (let s = 0; s < 2; s++) {
      const di = assigned[s];
      if (di === null) {
        const slot = this.slots[s];
        if (slot) {
          slot.missed++;
          if (slot.missed > MISS_LIMIT) {
            this.slots[s] = null;
            this.smoothers[s].reset();
          } else {
            out[s] = {
              landmarks: null,
              boundingBox: null,
              cx: slot.cx,
              cy: slot.cy,
              yawDeg: 0,
              gazeDx: 0,
              gazeDy: 0,
              energy: 0,
              present: false,
            };
          }
        }
        continue;
      }
      const d = det[di];
      const smooth = this.smoothers[s].update(
        d.f.landmarks,
        nowS,
      );
      const bb = boundingBoxOf(smooth);
      let slot = this.slots[s];
      if (!slot) {
        slot = {
          cx: d.cx,
          cy: d.cy,
          missed: 0,
          prevLm: null,
          energyEma: 0,
        };
        this.slots[s] = slot;
      }
      slot.missed = 0;
      slot.cx = d.cx;
      slot.cy = d.cy;

      // temporal energy per subject (same approach as primary path)
      if (slot.prevLm) {
        let sum = 0;
        const step = 16;
        let n = 0;
        for (let i = 0; i < smooth.length; i += step) {
          sum += Math.hypot(
            smooth[i].x - slot.prevLm[i].x,
            smooth[i].y - slot.prevLm[i].y,
          );
          n++;
        }
        const inst = n ? sum / n : 0;
        slot.energyEma =
          slot.energyEma === 0
            ? inst
            : slot.energyEma + 0.25 * (inst - slot.energyEma);
      }
      slot.prevLm = smooth.map((p) => ({ ...p }));

      const pose = poseFromLandmarks(smooth);
      const gaze = estimateGaze(smooth, mirrored);
      out[s] = {
        landmarks: smooth,
        boundingBox: bb,
        cx: d.cx,
        cy: d.cy,
        yawDeg: pose?.yawDeg ?? 0,
        gazeDx: gaze?.dx ?? 0,
        gazeDy: gaze?.dy ?? 0,
        energy: Math.min(1, slot.energyEma / 0.02),
        present: true,
      };
    }
    return out;
  }
}
