# AuraVision

**Live visual intelligence from monocular RGB video.**

AuraVision is a real-time computer-vision experience that interprets a
face through the camera — dense landmark tracking, facial geometry,
head-pose and gaze estimation, facial dynamics, relative depth and
illumination analysis — and renders that analysis as a minimal,
cinematic overlay.

This is deliberately **not** a filter. The camera feed is never altered;
the overlay only shows what the vision system sees.

## Quick start

```bash
npm install
npm run dev
# open http://localhost:3000
```

Allow camera access when prompted. Works on laptops and phones
(front camera default, `FRONT/REAR CAM` to switch). On a phone, use the
deployed HTTPS URL — `getUserMedia` requires a secure context.

## What it does

- **Dense facial landmark tracking** — MediaPipe FaceLandmarker, 478
  landmarks, browser-side WASM inference (GPU delegate, CPU fallback)
- **Hierarchical facial geometry** — silhouette → features → secondary
  contours → sparse internal scaffold, each with distinct visual weight
- **Temporal smoothing** — per-landmark One Euro filtering at render
  rate; stable at rest, responsive in motion
- **Head-pose estimation** — yaw / pitch / roll from the facial
  transformation matrix (landmark-geometry fallback)
- **Experimental gaze vectors** — iris-displacement direction estimate
  with honest confidence (not precise eye tracking)
- **Facial dynamics** — eye/mouth apertures, brow position, lip spread,
  temporal landmark-motion energy (descriptive, not emotional inference)
- **Relative depth field** — landmark z normalized and used to modulate
  scaffold intensity (relative depth, not a 3D scan)
- **Illumination field** — coarse luminance / contrast / direction
  analysis of the incoming image
- **Occlusion awareness** — degraded tracking detection; geometry fades
  rather than glitching, then recovers smoothly
- **Deep Scan** — a 4-second temporal sampling pass that produces a
  technical Visual Profile (geometry, stability, pose spread, gaze
  confidence, lighting, tracking quality)
- **Adaptive performance** — inference rate is scheduled separately from
  render rate; the overlay stays smooth when inference slows

## States

```
BOOT → SEARCHING → FACE DETECTED → INITIALIZING (staged emergence)
     → TRACKING → GEOMETRY LOCKED
     (OCCLUDED / LOST when degraded)
     → DEEP SCAN → VISUAL PROFILE
```

## Interface

- **Layer A** — untouched camera feed
- **Layer B** — facial intelligence overlay (geometry, gaze, depth)
- **Layer C** — quiet perimeter telemetry: status, head pose, gaze,
  temporal track

Public mode shows qualitative labels only. Press **D** (or `DEBUG`) for
the diagnostics panel — raw landmarks, inference Hz/ms, confidence,
dynamics, lighting, bounding box.

## Privacy

Everything runs in the browser. Camera frames go directly to the
on-device WASM model. No frames, landmarks, images or recordings are
uploaded or stored. The model and WASM runtime are vendored under
`public/mediapipe/` — no CDN contact at runtime, no analytics.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS 4
- `@mediapipe/tasks-vision` 1.x — FaceLandmarker (pretrained)
- Canvas 2D renderer — chosen over WebGL deliberately; see
  `docs/ARCHITECTURE.md`

## Docs

- `docs/ARCHITECTURE.md` — pipeline, modules, state machine, scheduler,
  pretrained vs. custom components
- `docs/CUSTOM_MODEL.md` — where a future learned model could fit

## Performance

Targets Intel Iris Xe laptops and modern smartphones. 720p input,
scheduled inference (~15–30 Hz adaptive), render-rate smoothing. Actual
FPS is reported in the debug panel.

## Known limitations

- Single primary face (`numFaces=2`, largest wins)
- Gaze is directional, not calibrated eye tracking
- Depth field is relative, not metric
- Iris landmarks share the shared filter bank
- MediaPipe landmark quality degrades past ~60° yaw — inherent model limit
