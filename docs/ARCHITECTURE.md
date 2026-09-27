# AuraVision V1 — Architecture

## Pipeline

```
getUserMedia stream
  └─► <video> element (display + inference share one element — no copies)
        └─► FaceLandmarker.detectForVideo()  [per new video frame]
              ├─► face landmarks (478 pts, normalized xyz)
              ├─► facial transformation matrix (4×4)  → head pose
              └─► face blendshapes (52 scores)        → expression signals
                    └─► most-prominent-face selection (largest bbox)
                          └─► LandmarkSmoother (One Euro filter per landmark)
                                └─► TrackingFrame (mutable store, no React)
                                      ├─► FaceMeshOverlay (canvas, own rAF)
                                      └─► StatusPanel/DebugPanel (10 Hz poll)
```

## Repository layout

```
app/                    Next.js entry (layout, page, globals)
components/
  AuraVisionApp.tsx     orchestrator — owns videoRef, session retry, debug flag
  camera/CameraFeed.tsx the <video> element (mirrored via CSS)
  face/FaceMeshOverlay.tsx  canvas renderer, reads frame ref each rAF
  ui/StatusPanel.tsx    state label + telemetry (10 Hz snapshot)
  ui/DebugPanel.tsx     diagnostics readout
lib/
  vision/camera.ts          getUserMedia, error mapping, stream release
  vision/faceLandmarker.ts  WASM/model loading, GPU→CPU fallback
  tracking/useFaceTracking.ts   the real-time loop (per-frame pipeline)
  tracking/useTelemetry.ts      low-rate React bridge to the frame store
  geometry/mesh.ts            MediaPipe connection tiers, bbox, face area
  geometry/pose.ts            matrix → yaw/pitch/roll + landmark fallback
  smoothing/oneEuro.ts        1€ filter implementation
  smoothing/landmarkSmoother.ts per-landmark filter bank
types/vision.ts           shared types, TrackingFrame store shape
public/mediapipe/         vendored WASM runtime + face_landmarker.task
docs/ARCHITECTURE.md      this file
```

## Key decisions

### Canvas 2D overlay instead of Three.js / R3F

Landmarks arrive in normalized 2D image coordinates; projecting them is
free. The heaviest production frame draws ~800 line segments — trivially
60fps on canvas 2D, including on Intel Iris Xe. Three.js would add a
scene graph, draw-call overhead, and a second render loop for zero visual
gain at this density. If V2 wants a true 3D shaded surface or point-cloud
depth effects, R3F becomes justified — the seam is `FaceMeshOverlay`,
which is the only file that knows how pixels get drawn.

### One Euro filtering (lib/smoothing)

Raw landmark jitter is ~±2px at rest — unacceptable for a cinematic mesh.
A naive EMA removes jitter but lags during head turns. One Euro solves
this: cutoff frequency rises with velocity, so stillness is heavily
smoothed and fast motion stays tight. Tunables live in
`LandmarkSmoother(1.2, 0.6)` — (minCutoff Hz, beta).

On face re-acquisition the filters reset and the first 2 frames snap
directly to raw values — prevents a visible "sweep in from old position".

### Pose from the transformation matrix

`outputFacialTransformationMatrixes` returns the canonical-face→camera
transform each frame. We extract the rotation block and decompose into
Tait-Bryan angles. A landmark-geometry fallback (nose-tip displacement
vs. eye span / face height) covers frames where the matrix is absent.

### Frame store outside React

The pipeline writes into a plain mutable `TrackingFrame` object. The
canvas reads it every rAF; React UI reads a snapshot at 10 Hz via
`useTelemetry`. Nothing in the 30–60 Hz path triggers a React render.

### Face-loss grace period

`detectForVideo` occasionally returns zero faces for a single frame
during fast motion or partial occlusion. The loop tolerates ≤6
consecutive misses before clearing landmarks and resetting state —
prevents flicker without masking genuine face loss.

### Stability metric

EMA of mean per-landmark displacement (sampled subset, every 12th point),
normalized against a "deliberate motion" constant. Drives the
tracking→locked transition and the `TRACKING: STABLE/UNSTABLE` label.
Confidence is a persistence EMA (fraction of recent frames with a face).

### Local vendored runtime

`public/mediapipe/wasm/*` + `face_landmarker.task` are shipped with the
app — no runtime CDN dependency, consistent with the privacy model.

## Error handling

| Condition | Behavior |
|---|---|
| Permission denied | error veil + explanatory label + RETRY |
| No camera | same, "no camera found" |
| Non-secure context / old browser | "not supported" |
| Camera unplugged mid-session | `ended` track event → error state |
| Model/WASM failure | GPU delegate → CPU retry → error state |
| Temporary face loss | 6-frame grace → back to searching |

## Performance notes (target: i5-1155G7 / Iris Xe)

- 720p input, VIDEO running mode (MediaPipe's internal temporal tracking
  is cheaper than per-frame detection)
- GPU delegate primary; the detect call is async on GPU and the loop only
  runs inference when `video.currentTime` advances (no wasted work)
- Canvas sized to `devicePixelRatio` (capped at 2) once per resize
- Landmark smoothing ~478×3 One Euro filters — ~1ms of pure JS per frame
- Observed: see README; verify FPS in the telemetry panel on target HW

## Known limitations / V2 candidates

- Pose matrix sign conventions verified on mirrored preview; extreme
  head angles (>~60° yaw) degrade landmark quality — MediaPipe limit.
- Iris landmarks exist but are not smoothed separately (they ride the
  shared filter bank).
- `numFaces=2`: a third+ person in frame is ignored entirely.
- Front-facing only (`facingMode: "user"`); no camera selector.
- V2 ideas: 3D shaded mesh via R3F, attention/gaze vector, recording of
  telemetry (not video), calibration screen, WebGPU delegate.
