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

## Canonical coordinate space (V6.2)

All visual consumers map normalized MediaPipe landmarks through
`lib/vision/imageTransform.ts` — the single place where coordinate math
lives. Pipeline:

```
source video (videoWidth × videoHeight)
  → normalized landmarks [0,1], unmirrored, y-down
    → coverFit()        object-fit:cover viewport (FaceMeshOverlay)
    → regionMapper()    flipped sub-rect draws (OptimalFrame,
                        CameraGeometryBlend, SignatureMesh reference)
    → coverSourceRect() share-artifact crops (portraitArtifact)
```

Mirroring convention: `mirrored` means the *rendered image* is flipped.
The flip applies within the rect actually drawn — full-frame draws use
`x' = 1 − x`; flipped sub-rect thumbnails use `x' = rect.x + rect.w − x`.
Mirroring in full-frame space and then subtracting a crop origin (the
pre-V6.2 bug) is off by `1 − 2·cropCenterX` whenever the face isn't
frame-centered.

DEBUG mode renders a LANDMARK REGISTRATION diagnostic on `OptimalFrame`:
labeled marks at eye/nose/mouth/chin/jaw indices — they must sit exactly
on the physical features of the captured frame.

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

## Pseudo-3D surface (V3)

`faceTriangles()` recovers ~930 triangles from the tessellation edge list
(one-time clique search). Per frame, triangles are painter-sorted by mean
relative z and filled with alpha scaled by screen-space normal facing +
proximity — a translucent geometric surface that reprojects naturally as
the head turns, on plain canvas 2D. A render-cost EMA relaxes triangle
stride (1→2→4) if drawing exceeds budget, so surface density degrades
gracefully on slow devices. WebGL remains a legitimate future path; the
seam is `FaceMeshOverlay`.

## Guided Deep Scan / Deep Analysis (V3–V4)

`DeepAnalysisRunner` (`lib/analysis/`) drives an 8-phase pass:
geometry → symmetry → proportion → gaze → dynamics → lighting →
guided camera angles (frontal → turn → opposite → reference) → signature.
Phase 6 reuses the pose-gated capture machinery: each view's landmarks
are averaged, de-rotated by mean yaw into a canonical cloud, and merged —
an honest multi-view approximation (pitch/roll alignment approximate).

Analysis modules are pure functions over existing landmarks/metrics:

- `symmetry.ts` — mirror-cloud nearest-point deviation → score + field
- `proportions.ts` — landmark ratios vs. canonical-face ranges →
  qualitative labels (not standards)
- `palette.ts` — 32×20 frame histogram → dominant swatches + warm/cool
- `vibe.ts` — deterministic descriptor scoring from observable metrics
- `runner.ts` — phase orchestration, framing/balance/lighting sub-scores,
  the EXPERIMENTAL aesthetic composite (weights: symmetry .25,
  lighting .25, proportion .20, balance .15, framing .15), report build

The composite is derived entirely from measurable quantities and is
labeled experimental — it is not an objective appearance judgment.

## V5 layer

- `lib/bestFrame/` — `scoring.ts` (normalized sub-scores) +
  `bestFrame.ts` (BestFrameEngine: evaluates every 500ms while tracked,
  keeps top-3 face-region JPEG thumbnails in memory, nothing uploaded)
- `lib/analysis/presence.ts` — Visual Presence descriptors from
  measurable signals; `aura.ts` — interpretive palette/motion descriptors
- `lib/visualization/meshRender.ts` — shared turntable projection used by
  `SignatureMesh` (live) and `artifact.ts` (static 1080×1440 share card)
- `components/visualization/AuraField.tsx` — palette-tinted ambient field
  anchored to signature-cloud points
- `components/results/OptimalFrame.tsx` — captured frame + geometry
  overlay toggle + qualitative breakdown

## Director Mode (V6)

`lib/director/director.ts` — `DirectorEngine`: ordered composition
checks (distance → framing → angle → gaze → lighting → stability)
evaluated each tick; the first unsatisfied check yields the single
instruction, so already-satisfied conditions are skipped. Composition
score = `scoreFrame` (shared with the best-frame engine). All checks
satisfied → ~0.95s hold → PORTRAIT READY → capture via
`BestFrameEngine.best()` → `DirectorResult` (readiness labels, achieved
view, lighting before/after, expression stats, aura). `CONTINUE ANYWAY`
appears after 12s unsatisfied; completion is never score-gated.

Components: `components/director/DirectorOverlay.tsx` (HUD),
`components/results/DirectorResult.tsx` (portrait card), and
`lib/visualization/portraitArtifact.ts` (1080×1620 share card — the
captured frame is included only in this explicit user-initiated share).

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
