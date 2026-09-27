"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { acquireCamera, releaseCamera, cameraErrorFrom, type CameraHandle } from "@/lib/vision/camera";
import { loadFaceLandmarker } from "@/lib/vision/faceLandmarker";
import { LandmarkSmoother } from "@/lib/smoothing/landmarkSmoother";
import { poseFromMatrix, poseFromLandmarks } from "@/lib/geometry/pose";
import { boundingBoxOf, faceArea } from "@/lib/geometry/mesh";
import type {
  ExpressionSignals,
  HeadPose,
  Landmark,
  TrackingFrame,
} from "@/types/vision";

export function createInitialFrame(): TrackingFrame {
  return {
    state: "boot",
    cameraError: null,
    landmarks: null,
    rawLandmarks: null,
    pose: null,
    expression: null,
    metrics: {
      fps: 0,
      inferenceMs: 0,
      landmarkCount: 0,
      facesDetected: 0,
      confidence: 0,
      stability: 1,
    },
    boundingBox: null,
    framesWithFace: 0,
    mirrored: true,
  };
}

/** Blendshape categories we care about for expression signals. */
function extractExpression(result: FaceLandmarkerResult, faceIndex: number): ExpressionSignals | null {
  const bs = result.faceBlendshapes?.[faceIndex]?.categories;
  if (!bs) return null;
  const get = (name: string) =>
    bs.find((c) => c.categoryName === name)?.score ?? 0;
  return {
    blinkLeft: get("eyeBlinkLeft"),
    blinkRight: get("eyeBlinkRight"),
    smile: (get("mouthSmileLeft") + get("mouthSmileRight")) / 2,
    mouthOpen: get("jawOpen"),
  };
}

/**
 * Owns the whole real-time pipeline: camera → inference → smoothing →
 * pose → metrics, written into a mutable TrackingFrame ref that the
 * canvas renderer and telemetry poll read at their own cadence.
 */
export function useFaceTracking(
  videoRef: MutableRefObject<HTMLVideoElement | null>,
  session = 0,
  facingMode: "user" | "environment" = "user",
) {
  const frameRef = useRef<TrackingFrame>(createInitialFrame());

  useEffect(() => {
    // Reset stale frame data on (re)boot — e.g. after a camera retry.
    Object.assign(frameRef.current, createInitialFrame());
    const frame = frameRef.current;
    let cancelled = false;
    let raf = 0;
    let camera: CameraHandle | null = null;
    const smoother = new LandmarkSmoother(1.2, 0.6);

    let lastTs = 0;
    let fpsEma = 0;
    let inferenceEma = 0;
    let speedEma = 0;
    let presenceEma = 0;
    let prevSmoothed: Landmark[] | null = null;
    let lostFrames = 0;

    async function boot() {
      frame.state = "boot";
      try {
        const landmarker = await loadFaceLandmarker();
        if (cancelled) return;

        frame.state = "idle";
        camera = await acquireCamera(videoRef.current ?? undefined, facingMode);
        if (cancelled) return;
        // Front camera previews are mirrored (like a mirror); rear camera
        // is shown unmirrored. Landmark mapping uses the same flag.
        frame.mirrored = facingMode === "user";

        // Detect mid-session camera disconnect.
        for (const track of camera.stream.getVideoTracks()) {
          track.addEventListener("ended", () => {
            frame.state = "error";
            frame.cameraError = "disconnected";
          });
        }

        frame.state = "searching";

        const loop = () => {
          if (cancelled || !camera) return;
          const video = camera.video;
          const now = performance.now();

          if (video.readyState >= 2 && video.currentTime !== lastTs) {
            lastTs = video.currentTime;
            const t0 = performance.now();
            const result = landmarker.detectForVideo(video, now);
            inferenceEma = ema(inferenceEma, performance.now() - t0, 0.15);

            processResult(result, now / 1000);
          }

          const dt = now - (loop as unknown as { _p?: number })._p!;
          (loop as unknown as { _p?: number })._p = now;
          if (dt > 0 && dt < 500) fpsEma = ema(fpsEma, 1000 / dt, 0.08);
          frame.metrics.fps = fpsEma;
          frame.metrics.inferenceMs = inferenceEma;

          raf = requestAnimationFrame(loop);
        };
        (loop as unknown as { _p?: number })._p = performance.now();
        raf = requestAnimationFrame(loop);
      } catch (err) {
        if (cancelled) return;
        frame.state = "error";
        frame.cameraError =
          (err as Error)?.name === "NotSupported"
            ? "not-supported"
            : cameraErrorFrom(err);
        if ((err as Error)?.message === "unsupported") {
          frame.cameraError = "not-supported";
        }
      }
    }

    function processResult(result: FaceLandmarkerResult, tSec: number) {
      const count = result.faceLandmarks?.length ?? 0;
      frame.metrics.facesDetected = count;
      presenceEma = ema(presenceEma, count > 0 ? 1 : 0, 0.1);
      frame.metrics.confidence = presenceEma;

      if (count === 0) {
        lostFrames++;
        frame.framesWithFace = 0;
        // Brief grace period before declaring the face gone — absorbs
        // single-frame dropouts during fast moves or occlusion.
        if (lostFrames > 6) {
          frame.state = "searching";
          frame.landmarks = null;
          frame.rawLandmarks = null;
          frame.pose = null;
          frame.expression = null;
          frame.boundingBox = null;
          smoother.reset();
          prevSmoothed = null;
        }
        return;
      }
      lostFrames = 0;

      // Most prominent face when more than one is present.
      let best = 0;
      let bestArea = 0;
      for (let i = 0; i < count; i++) {
        const a = faceArea(result.faceLandmarks[i] as Landmark[]);
        if (a > bestArea) {
          bestArea = a;
          best = i;
        }
      }

      const raw = result.faceLandmarks[best] as Landmark[];
      frame.rawLandmarks = raw;
      const smoothed = smoother.update(raw, tSec);
      frame.landmarks = smoothed;
      frame.metrics.landmarkCount = smoothed.length;
      frame.framesWithFace++;

      // --- stability: EMA of mean landmark displacement -------------
      if (prevSmoothed) {
        let sum = 0;
        const step = 12; // sample a representative subset
        const n = Math.floor(smoothed.length / step);
        for (let i = 0; i < smoothed.length; i += step) {
          sum += Math.hypot(smoothed[i].x - prevSmoothed[i].x,
                            smoothed[i].y - prevSmoothed[i].y);
        }
        speedEma = ema(speedEma, sum / Math.max(n, 1), 0.2);
      }
      prevSmoothed = smoothed.map((p) => ({ ...p }));
      // Normalize: ~0.015 normalized-units/frame ≈ deliberate motion.
      const stability = clamp01(1 - speedEma / 0.015);
      frame.metrics.stability = stability;

      // --- pose -------------------------------------------------------
      let pose: HeadPose | null = null;
      const mat = result.facialTransformationMatrixes?.[best]?.data;
      if (mat && mat.length >= 12) {
        pose = poseFromMatrix(mat);
      } else {
        pose = poseFromLandmarks(raw);
      }
      frame.pose = pose;

      frame.expression = extractExpression(result, best);
      frame.boundingBox = boundingBoxOf(smoothed);

      // --- state machine ---------------------------------------------
      if (frame.state === "searching" || frame.state === "idle") {
        frame.state = "detected";
      } else if (frame.state === "detected" && frame.framesWithFace > 8) {
        frame.state = "tracking";
      } else if (
        frame.state === "tracking" &&
        frame.framesWithFace > 60 &&
        stability > 0.55 &&
        presenceEma > 0.9
      ) {
        frame.state = "locked";
      } else if (frame.state === "locked" && (stability < 0.35 || presenceEma < 0.8)) {
        frame.state = "tracking";
      }
    }

    boot();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      releaseCamera(camera);
    };
  }, [videoRef, session, facingMode]);

  return { frameRef };
}

function ema(prev: number, value: number, alpha: number): number {
  return prev === 0 ? value : prev + alpha * (value - prev);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
