# AuraVision — Architecture

## Pipeline

```
getUserMedia stream
  └─► <video> (display + inference share one element — no copies)
        └─► InferenceScheduler — decides when detectForVideo runs
              └─► FaceLandmarker.detectForVideo()  [scheduled]
                    ├─► 478 landmarks (normalized xyz)
                    ├─► facial transformation matrix → head pose
                    └─► 52 blendshapes             → dynamics signals
                          └─► most-prominent-face selection
                                ├─► LandmarkSmoother (One Euro, at rAF rate)
                                ├─► estimateGaze()         lib/gaze
                                ├─► measureDynamics()      lib/dynamics
                                ├─► computeDepthField()    lib/depth
                                ├─► LightingAnalyzer       lib/lighting
                                ├─► occlusion heuristic    (edge + presence)
                                └─► DeepScanCollector      lib/scan (opt-in)
                                      └─► TrackingFrame (mutable store)
                                            ├─► FaceMeshOverlay (canvas, rAF)
                                            └─► Layer C UI (10 Hz telemetry)
```

## Repository layout

```
app/                      Next.js entry
components/
  AuraVisionApp.tsx       orchestrator — session retry, debug, facing, scan
  camera/CameraFeed.tsx   <video> (mirrored via CSS for front cam)
  face/FaceMeshOverlay.tsx  Layer B renderer — hierarchical geometry
  scan/VisualProfile.tsx  Deep Scan result screen
  ui/SystemInterface.tsx  Layer C — status + pose/gaze/track modules
  ui/DebugPanel.tsx       diagnostics (separate from public UI)
lib/
  vision/camera.ts        getUserMedia, error mapping, facingMode
  vision/faceLandmarker.ts WASM/model loading, GPU→CPU fallback
  tracking/useFaceTracking.ts   the real-time loop + state machine
  tracking/useTelemetry.ts      10 Hz React bridge to the frame store
  smoothing/oneEuro.ts          1€ filter
  smoothing/landmarkSmoother.ts per-landmark filter bank
  geometry/mesh.ts              MediaPipe connection tiers, bbox, area
  geometry/pose.ts              matrix → yaw/pitch/roll + fallback
  gaze/gaze.ts                  iris-displacement gaze estimate
  dynamics/dynamics.ts          apertures, spreads, motion energy
  depth/depth.ts                relative depth field from landmark z
  lighting/lighting.ts          luminance / contrast / direction
  performance/scheduler.ts      adaptive inference scheduling
  scan/deepScan.ts              temporal sampling → VisualProfile
types/vision.ts           shared types incl. TrackingFrame
public/mediapipe/         vendored WASM + face_landmarker.task
docs/
```

## Pretrained vs. custom — the important distinction

**Pretrained components** (MediaPipe / Google):
- `face_landmarker.task` — the landmark detection model itself
- WASM runtime (`tasks-vision`) — inference engine
- Blendshape + transformation-matrix outputs of that model

**AuraVision custom logic** (this repository):
- Temporal smoothing architecture (per-landmark One Euro bank)
- Inference scheduling (adaptive rate decoupled from render)
- Gaze estimation from iris displacement + aperture confidence
- Facial dynamics metrics (apertures, spreads, motion energy)
- Relative depth field normalization + depth-modulated rendering
- Illumination-field heuristic
- Occlusion/degradation heuristics
- The full state machine and cinematic initialization sequence
- Deep Scan collector + Visual Profile distillation
- All visualization, UI, and design

## State machine

```
boot → searching → detected ─(0.45s)─► initializing ─(1.9s)─► tracking
                                            initProgress stages geometry
                                     tracking ⇄ locked  (stability gate)
                                     tracking/locked ⇄ occluded
                                     any-face-state → lost → searching
                                     tracking/locked → deep_scan → complete
```

`frame.stateAge` + `frame.initProgress` drive the staged emergence —
nodes → oval → features → scaffold → brackets (smoothstep ramps in the
renderer, no timers in React).

## Adaptive performance

Three independent rates:

| Rate | Mechanism |
|---|---|
| Camera | `video.currentTime` advance detection |
| Inference | `InferenceScheduler` — min interval adapts to measured latency (≈2.5× inferenceMs, clamped 30–90ms) |
| Render | rAF always; `LandmarkSmoother.update()` re-filters the last raw result every frame, so geometry animates smoothly between inferences |

The One Euro filter converging on the latest raw values *is* the
interpolation mechanism — no separate extrapolator needed.

## Renderer design (Layer B)

Hierarchical visual weights:
- **L1** face oval — strongest stroke, clean silhouette
- **L2** eyes / brows / lips / iris — medium emphasis
- **L3** secondary contours — faint topology
- **L4** sparse scaffold (every 6th tessellation edge) — intensity
  modulated by normalized landmark z = the "relative depth field"
- **L5** locked-state surface tint + nose-bridge anchor

Gaze vectors are short lines from iris centers, flipped with mirroring,
attenuated by gaze confidence. Occlusion (`frame.occluded`) fades the
whole layer ~45% and suppresses iris/gaze geometry.

**Why not Three.js**: the landmark field is 2D-projected data; the
heaviest frame is ~800 line segments — trivial for canvas 2D on Iris Xe
and phone GPUs. A WebGL surface is a legitimate V3 option; the seam is
`FaceMeshOverlay` (the only file that draws).

## Signals

- **Pose**: Tait-Bryan decomposition of the facial transformation matrix;
  landmark-geometry fallback when absent.
- **Gaze**: iris-center offset within each eye-corner frame, aperture-
  weighted, labeled LEFT/RIGHT/UP/DOWN/CENTER or LOW CONFIDENCE.
- **Dynamics**: eye/mouth apertures (geometry-normalized), brow raise,
  lip spread + blendshape blink/smile/jawOpen, motion-energy EMA.
- **Depth**: z normalized per frame → per-landmark 0..1 (nose≈0, edge≈1).
- **Lighting**: 32×24 frame sample every 400ms → mean, contrast, gradient
  direction → DIFFUSE / LEFT-KEY / RIGHT-KEY / TOP-KEY / LOW LIGHT.
- **Stability**: EMA of mean landmark displacement (12th-point subset).
- **Occlusion**: bbox edge contact OR presence-EMA dip while face present.

## Deep Scan

`DeepScanCollector` samples the frame store for 4s and distills:
geometry completeness, mean stability %, pose spread (σ of yaw), gaze
confidence %, dynamics energy, illumination label, tracking quality —
rendered as a qualitative Visual Profile. No evaluative claims.

## Privacy

All inference is on-device WASM. Frames never leave the browser; no
uploads, storage, or analytics. Vendored model/WASM means zero runtime
CDN dependency.

## Known limitations

- `numFaces=2`; largest face wins.
- Gaze is monocular + uncalibrated — directional only.
- Depth field is relative per-frame; not temporally stabilized or metric.
- Lighting reads the whole frame, not face-local photometry.
- MediaPipe degrades at extreme head angles / heavy occlusion — the app
  detects and degrades gracefully rather than fixing it.
