# Future Custom Model — Integration Points

AuraVision currently uses **MediaPipe's pretrained FaceLandmarker** for
all learned inference. This document describes where a future
custom-trained AuraVision model could slot in — and what it should
(and should not) be for.

## Current learned component boundary

Everything learned today lives behind one seam:

```
lib/vision/faceLandmarker.ts   — model loading + wrapper
    ↓ FaceLandmarkerResult
lib/tracking/useFaceTracking.ts — consumes landmarks / matrix / blendshapes
```

All downstream analysis (gaze, dynamics, depth, lighting, occlusion,
deep scan) is **AuraVision code** operating on landmark geometry — it
would carry over to any replacement or additional model.

## Where a custom model would fit

Three plausible integration points, in increasing effort:

### 1. Auxiliary signal model (recommended first step)

A small model that produces an additional signal *alongside* MediaPipe
landmarks — e.g., a calibrated gaze-regression head that consumes the
iris landmark patch and outputs gaze angles, or an occlusion-confidence
head that scores per-region landmark reliability.

- Input: smoothed landmarks (already available per frame)
- Runtime: ONNX Runtime Web or TF.js — must stay browser-side
- Integration: new `lib/<signal>/` module replacing the heuristic
  (e.g. `lib/gaze/` gains a learned path; the `GazeEstimate` interface
  stays identical so nothing downstream changes)

### 2. Landmark refinement head

A lightweight corrector network refining MediaPipe's 478 points for a
specific failure mode (extreme yaw, partial occlusion). Consumes raw
landmarks → outputs corrected landmarks into `LandmarkSmoother`.

### 3. Full replacement model

Replacing FaceLandmarker entirely requires solving detection +
tracking + landmarks at ≥30 Hz in WASM/WebGL — a large undertaking.
Only worth it if the pretrained model is the bottleneck.

## Hard constraints for any future model

- Runs **fully in-browser** (WASM / WebGL / WebGPU) — no cloud inference
- Small enough for Iris Xe + mid-range phones (< ~10 MB weights)
- Solves a **clearly defined technical problem** — never evaluative
  claims (beauty, health, emotion, identity)
- Keeps the `TrackingFrame` contract so visualization is unchanged

## Explicit non-goals

- Identity / face recognition
- Beauty or attractiveness scoring
- Emotion/psychological inference
- Health estimation
