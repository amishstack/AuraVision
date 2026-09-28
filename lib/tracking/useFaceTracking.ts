"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { acquireCamera, releaseCamera, cameraErrorFrom, type CameraHandle } from "@/lib/vision/camera";
import { loadFaceLandmarker } from "@/lib/vision/faceLandmarker";
import { LandmarkSmoother } from "@/lib/smoothing/landmarkSmoother";
import { InferenceScheduler } from "@/lib/performance/scheduler";
import { LightingAnalyzer } from "@/lib/lighting/lighting";
import { DeepAnalysisRunner } from "@/lib/analysis/runner";
import { BestFrameEngine, toBestFrameResult } from "@/lib/bestFrame/bestFrame";
import { estimateGaze } from "@/lib/gaze/gaze";
import { measureDynamics, type BlendshapeSignals } from "@/lib/dynamics/dynamics";
import { computeDepthField } from "@/lib/depth/depth";
import { poseFromMatrix, poseFromLandmarks } from "@/lib/geometry/pose";
import { boundingBoxOf, faceArea } from "@/lib/geometry/mesh";
import type {
  HeadPose,
  Landmark,
  TrackingFrame,
  TrackingState,
} from "@/types/vision";

export function createInitialFrame(): TrackingFrame {
  return {
    state: "boot",
    cameraError: null,
    landmarks: null,
    rawLandmarks: null,
    pose: null,
    gaze: null,
    dynamics: null,
    lighting: null,
    depth: null,
    metrics: {
      fps: 0,
      inferenceHz: 0,
      inferenceMs: 0,
      landmarkCount: 0,
      facesDetected: 0,
      confidence: 0,
      stability: 1,
    },
    boundingBox: null,
    framesWithFace: 0,
    mirrored: true,
    stateAge: 0,
    initProgress: 0,
    occluded: false,
    scanProgress: 0,
    scan: null,
    symmetryField: null,
    frameCandidates: [],
    frameCandidateNo: 0,
    bestFrameQuality: 0,
    newBestAt: 0,
    optimalFrame: null,
    report: null,
  };
}

// Initialization-sequence pacing (seconds)
const T_DETECTED = 0.45;
const T_INIT = 2.0;
const LOCK_FRAMES = 60;

function extractBlendshapes(
  result: FaceLandmarkerResult,
  faceIndex: number,
): BlendshapeSignals | null {
  const bs = result.faceBlendshapes?.[faceIndex]?.categories;
  if (!bs) return null;
  const get = (name: string) =>
    bs.find((c) => c.categoryName === name)?.score ?? 0;
  return {
    blinkLeft: get("eyeBlinkLeft"),
    blinkRight: get("eyeBlinkRight"),
    smile: (get("mouthSmileLeft") + get("mouthSmileRight")) / 2,
    jawOpen: get("jawOpen"),
  };
}

export interface TrackingControls {
  frameRef: MutableRefObject<TrackingFrame>;
  /** Request a Deep Scan — takes effect when tracking is stable. */
  startDeepScan: () => void;
  /** Leave the visual-profile screen, back to live tracking. */
  exitProfile: () => void;
}

export function useFaceTracking(
  videoRef: MutableRefObject<HTMLVideoElement | null>,
  session = 0,
  facingMode: "user" | "environment" = "user",
): TrackingControls {
  const frameRef = useRef<TrackingFrame>(createInitialFrame());
  const scanRequested = useRef(false);
  const profileExit = useRef(false);

  useEffect(() => {
    Object.assign(frameRef.current, createInitialFrame());
    const frame = frameRef.current;
    let cancelled = false;
    let raf = 0;
    let camera: CameraHandle | null = null;
    const smoother = new LandmarkSmoother(1.2, 0.6);
    const scheduler = new InferenceScheduler();
    const lighting = new LightingAnalyzer(400);
    const analysis = new DeepAnalysisRunner();
    const bestFrames = new BestFrameEngine();
    let secondFaceCx: number | null = null;

    // gaze temporal smoothing + label hysteresis
    let gazeDx = 0, gazeDy = 0, gazeConf = 0;
    let gazeLabel = "CENTER";

    let prevRaf = performance.now();
    let fpsEma = 0;
    let inferenceEma = 0;
    let speedEma = 0;
    let presenceEma = 0;
    let prevSmoothed: Landmark[] | null = null;
    let lostFrames = 0;
    let stateStart = performance.now();
    let rawCache: Landmark[] | null = null;

    const setState = (s: TrackingState, now: number) => {
      if (frame.state !== s) {
        frame.state = s;
        stateStart = now;
      }
    };

    async function boot() {
      try {
        const landmarker = await loadFaceLandmarker();
        if (cancelled) return;

        camera = await acquireCamera(videoRef.current ?? undefined, facingMode);
        if (cancelled) return;
        frame.mirrored = facingMode === "user";

        for (const track of camera.stream.getVideoTracks()) {
          track.addEventListener("ended", () => {
            setState("error", performance.now());
            frame.cameraError = "disconnected";
          });
        }

        setState("searching", performance.now());

        const loop = () => {
          if (cancelled || !camera) return;
          raf = requestAnimationFrame(loop);
          const video = camera.video;
          const now = performance.now();

          // --- render-rate metrics ------------------------------------
          const dt = now - prevRaf;
          prevRaf = now;
          if (dt > 0 && dt < 500) fpsEma = ema(fpsEma, 1000 / dt, 0.08);
          frame.metrics.fps = fpsEma;
          frame.metrics.inferenceMs = inferenceEma;
          frame.metrics.inferenceHz = scheduler.inferenceHz(now);
          frame.stateAge = (now - stateStart) / 1000;

          // --- inference (scheduled) -----------------------------------
          if (scheduler.shouldInfer(video, inferenceEma, now)) {
            const t0 = performance.now();
            const result = landmarker.detectForVideo(video, now);
            inferenceEma = ema(inferenceEma, performance.now() - t0, 0.15);
            processResult(result);
          }

          // --- render-rate smoothing (interpolates between inferences)
          if (rawCache && frame.landmarks) {
            frame.landmarks = smoother.update(rawCache, now / 1000);
          }

          // --- lighting (self-throttled) -------------------------------
          frame.lighting = lighting.update(video, now);

          // --- best-frame evaluation (stable tracking only) ------------
          if (
            frame.state === "tracking" ||
            frame.state === "locked" ||
            frame.state === "analysis"
          ) {
            bestFrames.update(
              video,
              {
                stability: frame.metrics.stability,
                confidence: presenceEma,
                occluded: frame.occluded,
                pose: frame.pose,
                gaze: frame.gaze,
                lighting: frame.lighting,
                boundingBox: frame.boundingBox,
                landmarks: frame.landmarks,
                mirrored: frame.mirrored,
              },
              now,
              analysis.phaseIndex === 7 ? 300 : 500,
            );
          }

          // --- deep scan lifecycle -------------------------------------
          if (scanRequested.current) {
            scanRequested.current = false;
            if (frame.state === "tracking" || frame.state === "locked") {
              analysis.begin(now);
              bestFrames.reset(); // recalibrate candidates for this pass
              frame.optimalFrame = null;
              frame.frameCandidates = [];
              frame.frameCandidateNo = 0;
              frame.bestFrameQuality = 0;
              frame.newBestAt = 0;
              setState("analysis", now);
            }
          }
          if (frame.state === "analysis") {
            frame.scanProgress = analysis.progress(now);
            frame.scan = analysis.ui(now);
            frame.symmetryField = analysis.symmetryFieldForRender();
            analysis.sample({
              now,
              facePresent: frame.landmarks !== null,
              stability: frame.metrics.stability,
              landmarkCount: frame.metrics.landmarkCount,
              landmarks: frame.landmarks,
              boundingBox: frame.boundingBox,
              pose: frame.pose,
              gaze: frame.gaze,
              dynamics: frame.dynamics,
              lighting: frame.lighting,
              facesDetected: frame.metrics.facesDetected,
              secondFaceCx,
              occluded: frame.occluded,
              candidatesEvaluated: bestFrames.evaluatedCount(),
            });
            // candidate strip UI state
            frame.frameCandidates = bestFrames.historyEntries().map((h) => ({
              quality: h.quality,
              isBest: h.isBest,
            }));
            frame.frameCandidateNo =
              analysis.phaseIndex === 7
                ? analysis.phaseCandidates()
                : bestFrames.evaluatedCount();
            frame.bestFrameQuality = bestFrames.bestQualityPct();
            frame.newBestAt = bestFrames.lastNewBestAt();
            // freeze the selected frame once the FRAME phase completes
            if (analysis.phaseIndex >= 8 && !frame.optimalFrame) {
              const best = bestFrames.best();
              if (best) frame.optimalFrame = toBestFrameResult(best);
            }
            if (analysis.isDone(now)) {
              frame.report = analysis.finish(
                video,
                bestFrames.best(),
                bestFrames.evaluatedCount(),
              );
              frame.scanProgress = 1;
              frame.scan = null;
              frame.symmetryField = null;
              setState("complete", now);
            }
          }
          if (profileExit.current) {
            profileExit.current = false;
            frame.report = null;
            setState(
              frame.landmarks ? "tracking" : "searching",
              now,
            );
          }
        };
        raf = requestAnimationFrame(loop);
      } catch (err) {
        if (cancelled) return;
        setState("error", performance.now());
        frame.cameraError =
          (err as Error)?.name === "NotSupported" ||
          (err as Error)?.message === "unsupported"
            ? "not-supported"
            : cameraErrorFrom(err);
      }
    }

    function processResult(result: FaceLandmarkerResult) {
      const count = result.faceLandmarks?.length ?? 0;
      frame.metrics.facesDetected = count;
      presenceEma = ema(presenceEma, count > 0 ? 1 : 0, 0.1);
      frame.metrics.confidence = presenceEma;

      if (count === 0) {
        lostFrames++;
        frame.framesWithFace = 0;
        if (lostFrames > 6) {
          // Was tracked → brief LOST state, then back to searching.
          // COMPLETE (profile screen) and ERROR persist regardless.
          const wasTracking =
            frame.state === "tracking" ||
            frame.state === "locked" ||
            frame.state === "occluded" ||
            frame.state === "analysis";
          if (frame.state === "complete" || frame.state === "error") {
            // leave the profile / error state untouched
          } else if (frame.state !== "searching" && frame.state !== "lost") {
            setState(wasTracking ? "lost" : "searching", performance.now());
          }
          if (frame.state === "lost" && frame.stateAge > 1.2) {
            setState("searching", performance.now());
          }
          frame.landmarks = null;
          frame.rawLandmarks = null;
          frame.pose = null;
          frame.gaze = null;
          frame.dynamics = null;
          frame.depth = null;
          frame.boundingBox = null;
          frame.occluded = false;
          gazeDx = 0;
          gazeDy = 0;
          gazeConf = 0;
          gazeLabel = "CENTER";
          rawCache = null;
          smoother.reset();
          prevSmoothed = null;
        }
        return;
      }
      lostFrames = 0;

      // Most prominent face when more than one is present.
      let best = 0;
      let bestArea = 0;
      secondFaceCx = null;
      for (let i = 0; i < count; i++) {
        const a = faceArea(result.faceLandmarks[i] as Landmark[]);
        const bb = boundingBoxOf(result.faceLandmarks[i] as Landmark[]);
        if (a > bestArea) {
          bestArea = a;
          best = i;
        } else if (bb) {
          secondFaceCx = bb.x + bb.w / 2;
        }
      }

      const raw = result.faceLandmarks[best] as Landmark[];
      rawCache = raw;
      frame.rawLandmarks = raw;
      const smoothed = smoother.update(raw, performance.now() / 1000);
      frame.landmarks = smoothed;
      frame.metrics.landmarkCount = smoothed.length;
      frame.framesWithFace++;

      // --- temporal motion energy + stability --------------------------
      if (prevSmoothed) {
        let sum = 0;
        const step = 12;
        const n = Math.floor(smoothed.length / step);
        for (let i = 0; i < smoothed.length; i += step) {
          sum += Math.hypot(
            smoothed[i].x - prevSmoothed[i].x,
            smoothed[i].y - prevSmoothed[i].y,
          );
        }
        speedEma = ema(speedEma, sum / Math.max(n, 1), 0.2);
      }
      prevSmoothed = smoothed.map((p) => ({ ...p }));
      const stability = clamp01(1 - speedEma / 0.015);
      frame.metrics.stability = stability;

      // --- derived signals ----------------------------------------------
      const mat = result.facialTransformationMatrixes?.[best]?.data;
      const pose: HeadPose | null =
        mat && mat.length >= 12 ? poseFromMatrix(mat) : poseFromLandmarks(raw);
      frame.pose = pose;

      // --- gaze: smooth the estimate + label hysteresis -----------------
      const g = estimateGaze(smoothed, frame.mirrored);
      if (g) {
        gazeDx = ema(gazeDx, g.dx, 0.25);
        gazeDy = ema(gazeDy, g.dy, 0.25);
        gazeConf = ema(gazeConf, g.confidence, 0.2);
        // Hysteresis: keep the previous label unless the new direction
        // clearly dominates — prevents flicker near thresholds.
        const nl = g.label;
        if (nl !== gazeLabel) {
          const strong =
            nl === "LOW CONFIDENCE" ||
            gazeConf < 0.35 ||
            Math.max(Math.abs(gazeDx), Math.abs(gazeDy)) > 0.55;
          if (strong || gazeLabel === "LOW CONFIDENCE") gazeLabel = nl;
        }
        frame.gaze = {
          dx: gazeDx,
          dy: gazeDy,
          confidence: gazeConf,
          label: gazeLabel as typeof g.label,
        };
      } else {
        frame.gaze = null;
      }
      frame.dynamics = measureDynamics(
        smoothed,
        extractBlendshapes(result, best),
        clamp01(speedEma / 0.02),
      );
      const depthField = computeDepthField(smoothed);
      frame.depth = depthField?.info ?? null;
      frame.boundingBox = boundingBoxOf(smoothed);

      // --- occlusion / degradation heuristic ----------------------------
      const bb = frame.boundingBox;
      const edge = bb
        ? bb.x < 0.01 || bb.y < 0.01 || bb.x + bb.w > 0.99 || bb.y + bb.h > 0.99
        : false;
      frame.occluded =
        edge || (presenceEma < 0.75 && frame.framesWithFace > 5);

      // --- state machine ------------------------------------------------
      const now = performance.now();
      switch (frame.state) {
        case "searching":
        case "lost":
          frame.initProgress = 0;
          setState("detected", now);
          break;
        case "detected":
          if (frame.stateAge >= T_DETECTED) setState("initializing", now);
          break;
        case "initializing":
          frame.initProgress = Math.min(frame.stateAge / T_INIT, 1);
          if (frame.stateAge >= T_INIT) {
            frame.initProgress = 1;
            setState("tracking", now);
          }
          break;
        case "tracking":
          if (frame.occluded) setState("occluded", now);
          else if (
            frame.framesWithFace > LOCK_FRAMES &&
            stability > 0.55 &&
            presenceEma > 0.9
          ) {
            setState("locked", now);
          }
          break;
        case "locked":
          if (frame.occluded) setState("occluded", now);
          else if (stability < 0.35 || presenceEma < 0.8) {
            setState("tracking", now);
          }
          break;
        case "occluded":
          if (!frame.occluded) setState("tracking", now);
          break;
        case "analysis":
          // handled in the rAF loop; keep scanning even if degraded
          break;
        default:
          break;
      }
    }

    boot();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      releaseCamera(camera);
      lighting.reset();
    };
  }, [videoRef, session, facingMode]);

  return {
    frameRef,
    startDeepScan: () => {
      scanRequested.current = true;
    },
    exitProfile: () => {
      profileExit.current = true;
    },
  };
}

function ema(prev: number, value: number, alpha: number): number {
  return prev === 0 ? value : prev + alpha * (value - prev);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
