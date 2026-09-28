export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export type TrackingState =
  | "boot"          // model / wasm loading
  | "searching"     // camera live, no face
  | "detected"      // face seen, brief acknowledgment
  | "initializing"  // cinematic acquisition sequence
  | "tracking"      // landmarks flowing
  | "locked"        // sustained stable temporal lock
  | "occluded"      // face present but landmark quality degraded
  | "lost"          // face was tracked, recently disappeared
  | "deep_scan"     // user-triggered multi-second analysis pass
  | "complete"      // visual profile screen
  | "error";

export type CameraError =
  | "permission-denied"
  | "no-camera"
  | "not-supported"
  | "disconnected"
  | "model-failed"
  | "unknown";

export interface HeadPose {
  yawDeg: number;   // + = turn right (as seen by viewer)
  pitchDeg: number; // + = looking up
  rollDeg: number;  // + = clockwise tilt
}

export type GazeLabel =
  | "CENTER" | "LEFT" | "RIGHT" | "UP" | "DOWN"
  | "UP-LEFT" | "UP-RIGHT" | "LOW CONFIDENCE";

export interface GazeEstimate {
  /** Horizontal gaze offset, roughly -1..+1 (negative = looking left). */
  dx: number;
  /** Vertical gaze offset, roughly -1..+1 (negative = looking up). */
  dy: number;
  confidence: number; // 0..1
  label: GazeLabel;
}

export interface FacialDynamics {
  eyeAperture: number;  // normalized eye openness, ~0..1
  mouthAperture: number; // normalized lip gap, ~0..1
  browRaise: number;    // normalized brow-to-eye distance
  lipSpread: number;    // mouth width relative to face width
  jawOpen: number;      // 0..1 (blendshape when available)
  blinkLeft: number;    // 0..1 blendshape
  blinkRight: number;   // 0..1 blendshape
  smile: number;        // 0..1 blendshape
  /** EMA of landmark-field motion — "temporal landmark motion". */
  energy: number;       // 0..1
}

export interface LightingInfo {
  mean: number;      // 0..1 average luminance
  contrast: number;  // 0..1 std-dev of luminance
  dirX: number;      // -1..1 illumination gradient (bright side)
  dirY: number;      // -1..1
  label: string;     // human-readable summary
}

export interface DepthInfo {
  /** Normalized per-landmark depth curve stats (relative, unitless). */
  range: number;
  valid: boolean;
}

export interface FrameMetrics {
  fps: number;           // render loop rate
  inferenceHz: number;   // actual model invocations / second
  inferenceMs: number;
  landmarkCount: number;
  facesDetected: number;
  confidence: number;    // presence persistence 0..1
  stability: number;     // smoothed-landmark stability 0..1
}

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VisualProfile {
  durationMs: number;
  geometry: string;      // e.g. "FACIAL CONTOUR ACQUIRED"
  stabilityPct: number;  // 0..100
  stabilityLabel: string;
  poseSpreadDeg: number;
  gazeConfidencePct: number;
  dynamicsEnergy: string; // LOW / MODERATE / HIGH
  lighting: string;      // e.g. "LEFT-KEY DIRECTIONAL"
  trackingQuality: string;
  landmarkCount: number;
  /** Multi-view merged canonical face points (x,y,z triples, centered,
   *  normalized). Drives the Visual Signature turntable hero. */
  signaturePoints: Float32Array | null;
  signaturePointCount: number;
  viewsCaptured: number;  // how many guided poses contributed
}

/** Guided Deep Scan phase descriptors shown in the UI checklist. */
export interface ScanPhaseUI {
  instruction: string;        // e.g. "LOOK FORWARD"
  checks: boolean[];          // per-phase completion
  labels: string[];           // per-phase names: FRONTAL / LEFT / RIGHT / REF
}

/** Mutable per-frame store — written by the tracking loop, read by the
 *  renderer every rAF and by React telemetry at ~10 Hz. */
export interface TrackingFrame {
  state: TrackingState;
  cameraError: CameraError | null;
  landmarks: Landmark[] | null;        // smoothed, normalized
  rawLandmarks: Landmark[] | null;
  pose: HeadPose | null;
  gaze: GazeEstimate | null;
  dynamics: FacialDynamics | null;
  lighting: LightingInfo | null;
  depth: DepthInfo | null;
  metrics: FrameMetrics;
  boundingBox: BoundingBox | null;
  framesWithFace: number;
  mirrored: boolean;

  // --- V2 additions ---------------------------------------------------
  /** Seconds since current state began (drives init-sequence timing). */
  stateAge: number;
  /** Fractional progress of the initialization sequence, 0..1. */
  initProgress: number;
  /** Edge contact / degraded-quality flag while a face is present. */
  occluded: boolean;
  /** Deep Scan progress 0..1 while state === "deep_scan". */
  scanProgress: number;
  /** Guided scan UI info while deep_scan. */
  scan: ScanPhaseUI | null;
  /** Latest visual profile (valid in "complete" state). */
  profile: VisualProfile | null;
}
