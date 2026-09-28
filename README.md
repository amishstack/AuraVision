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
- **Pseudo-3D surface** — the MediaPipe tessellation recovered as ~930
  triangles, painter-sorted by relative z and shaded by screen-space
  normals; the surface reprojects naturally as the head turns
- **Relative depth field** — landmark z normalized per frame, modulating
  scaffold intensity and surface shading (relative depth, not a 3D scan)
- **Illumination field** — coarse luminance / contrast / direction
  analysis of the incoming image
- **Occlusion awareness** — degraded tracking detection; geometry fades
  rather than glitching, then recovers smoothly
- **Guided Deep Scan** — a directed multi-angle acquisition (forward →
  turn → opposite turn → forward) whose per-view landmark captures are
  de-rotated into a canonical cloud — honest multi-view geometry, not
  metric reconstruction
- **Visual Signature** — the Deep Scan artifact: a slow turntable render
  of the merged geometry with a handful of qualitative attributes,
  designed to be screenshot-worthy
- **Adaptive performance** — inference rate is scheduled separately from
  render rate, and surface density auto-relaxes if drawing gets slow; the
  overlay stays smooth when inference slows

## Deep Analysis (V4)

A guided second experience (`DEEP ANALYSIS` button once tracking locks)
that runs an 8-phase cinematic pass — geometry → symmetry → proportion →
gaze → dynamics → lighting → camera angles → signature — and produces a
**Visual Signature**:

- **Visual Aesthetic — Experimental** composite (0–100) built from
  measurable quantities: geometric symmetry, proportional ratios,
  balance, framing, lighting. Explicitly not a beauty judgment.
- **Geometric symmetry map** — mirrored-ghost comparison + deviation
  field during the symmetry phase
- **Proportional structure** — landmark ratios (eye spacing, thirds,
  jaw/mouth) labeled BALANCED / MODERATE / VARIABLE
- **Preferred view** — frontal / left-¾ / right-¾ by stability+framing
- **Lighting report** — quality label + actionable suggestions
- **Gaze signature** — direction proportions + stability
- **Visual vibe** — deterministic playful descriptors (entertainment,
  labeled as such)
- **Visual palette** — dominant frame colors + warm/cool/contrast
- **Camera ⇄ Geometry blend slider** — scrub between the live frame and
  the reconstructed geometry
- **Share** — native share API (image blob when supported, text
  otherwise); nothing is uploaded
- **Demo mode** — `DEMO` strips chrome for hand-the-phone demos

All analysis runs client-side on already-computed landmarks — no extra
inference.

## V5 — Visual Presence Lab

- **Best Frame engine** (`lib/bestFrame/`) — continuously scores stable
  frames on visibility / lighting / angle / framing / gaze / steadiness,
  keeping top-3 as small local JPEG thumbnails (memory only)
- **Optimal Frame** — captured frame on the result card with a geometry
  overlay toggle and qualitative quality breakdown
- **Visual Presence** — 3 descriptors from measurable signals
  (stability, contrast, energy, framing) with the measurable basis shown
- **Aura Profile** — 3 interpretive descriptors from palette/contrast/
  lighting direction/motion/gaze distribution, explicitly labeled
- **Aura Field** — ambient canvas behind the hero: palette-tinted arcs
  and particles anchored to the reconstructed point cloud
- **Result redesign** — larger turntable hero, staggered reveal, count-up
  scores, gaze-signature distribution bar, per the artifact hierarchy
- **Share artifact** — SHARE renders a 1080×1440 generated card (mesh +
  scores + aura + palette; no camera imagery) via `navigator.share`

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
