# AuraVision

Real-time facial geometry visualization. AuraVision tracks a face through
the webcam, reconstructs its landmark geometry, and renders the vision
system's internal state as a minimal, cinematic overlay.

This is deliberately **not** a beauty filter. The camera feed is never
altered — the overlay only shows what the model sees.

## Quick start

```bash
npm install
npm run dev
# open http://localhost:3000
```

Then allow camera access when prompted.

For a production build:

```bash
npm run build && npm start
```

## What it does

- Acquires the camera locally (`getUserMedia`, 720p preferred) — works on
  laptops and phones; front camera preferred, `FRONT/REAR CAM` button
  switches on devices with multiple cameras (front preview is mirrored,
  rear is not, and landmark mapping follows)
- Runs **MediaPipe FaceLandmarker** in the browser (WASM, GPU delegate
  with CPU fallback) — 478 landmarks per frame
- Tracks a single primary face; if multiple faces appear, the most
  prominent is used
- Temporally smooths every landmark with a **One Euro filter** to remove
  jitter without adding perceptible lag
- Estimates head pose (yaw / pitch / roll) from the facial transformation
  matrix
- Renders the reconstructed geometry on a canvas overlay: sparse interior
  scaffold, feature contours (eyes, brows, lips, irises), face silhouette,
  and bounding brackets
- Reports FPS, inference latency, landmark count, tracking stability and
  confidence

### States

| State | UI |
|---|---|
| boot / idle | `SYSTEM READY` |
| searching | `SEARCHING FOR FACE` + center reticle |
| detected | `FACE DETECTED / INITIALIZING LANDMARKS` + raw nodes |
| tracking | mesh + telemetry |
| locked | denser geometry, silhouette emphasis, surface tint |
| error | camera error + retry |

### Debug mode

Press **D** or click `DEBUG` in the header. Shows raw (unsmoothed)
landmark dots, bounding box, pose axes, inference latency, confidence,
stability and expression signals (blink / smile / mouth open).

## Privacy

Everything runs in the browser. Camera frames are passed directly to the
on-device WASM model; nothing is uploaded, recorded, or stored. The model
file and WASM runtime are vendored in `public/mediapipe/` so no CDN is
contacted at runtime either.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS 4
- `@mediapipe/tasks-vision` 1.0.1 — FaceLandmarker
- Canvas 2D overlay for rendering (see `docs/ARCHITECTURE.md` for why
  this beats WebGL here)

## Docs

- `docs/ARCHITECTURE.md` — pipeline, modules, smoothing, pose math,
  performance notes, known limitations
