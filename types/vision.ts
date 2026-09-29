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
  | "analysis"      // guided Deep Analysis pass
  | "director"      // V6 guided portrait composition
  | "lab"           // V7 Expression Lab
  | "freelab"       // V7.2 Free Expression Lab
  | "duo"           // V8 Aura Duo
  | "complete"      // visual signature / director result screen
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

/** Measurable proportion item — qualitative label, not a standard. */
export interface ProportionItem {
  name: string;
  ratio: number;
  label: "BALANCED" | "MODERATE" | "VARIABLE";
}

export interface LightingReport {
  label: string;            // GOOD / MODERATE / LOW
  detail: string;           // e.g. "LEFT-KEY DIRECTIONAL"
  suggestions: string[];
}

export interface GazeSignature {
  center: number; // 0..1 proportions
  left: number;
  right: number;
  other: number;
  stabilityLabel: string; // HIGH / MEDIUM / LOW
}

export interface PaletteReport {
  colors: string[]; // hex strings, most dominant first
  temperature: "WARM" | "COOL" | "NEUTRAL";
  contrastLabel: "HIGH CONTRAST" | "LOW CONTRAST" | "BALANCED";
}

export interface AestheticReport {
  /** EXPERIMENTAL VISUAL METRIC — composite 0..100. Not a beauty score. */
  total: number;
  symmetry: number;
  proportion: number;
  balance: number;
  framing: number;
  lighting: number;
}

export interface BestFrameResult {
  /** small local JPEG data-URL of the face region */
  image: string;
  landmarks: Landmark[];
  crop: { x: number; y: number; w: number; h: number };
  parts: {
    lighting: number;
    framing: number;
    angle: number;
    visibility: number;
    gaze: number;
    steadiness: number;
  };
  angleLabel: string;
}

export interface AnalysisReport {
  aesthetic: AestheticReport;
  symmetryPct: number;
  symmetryLabel: "HIGH" | "MODERATE" | "VARIABLE";
  proportions: ProportionItem[];
  proportionLabel: "BALANCED" | "MODERATE" | "VARIABLE";
  preferredView: string;   // FRONTAL / LEFT 3/4 / RIGHT 3/4
  lighting: LightingReport;
  gaze: GazeSignature;
  dynamicsLabel: string;
  vibe: string[];
  palette: PaletteReport | null;
  signaturePoints: Float32Array | null;
  viewsCaptured: number;
  landmarkCount: number;
  secondFaceSeen: boolean;
  compositionLabel: string | null;
  /** V5 */
  presence: string[];       // visual descriptors from measurable signals
  presenceBasis: string[];  // the measurable basis per descriptor
  aura: string[];           // interpretive visual descriptors
  bestFrame: BestFrameResult | null;
  candidatesEvaluated: number;
}

/** Deep Analysis phase descriptors shown in the UI checklist. */
export interface ScanPhaseUI {
  instruction: string;        // e.g. "LOOK FORWARD"
  checks: boolean[];          // per-phase completion
  labels: string[];           // per-phase names
}

// ---------------------------------------------------------------------------
// V6 — Director Mode
// ---------------------------------------------------------------------------

export type DirectorTarget = "frontal" | "left" | "right";

export interface DirectorCheck {
  name: string;
  done: boolean;
}

export interface DirectorUI {
  phase: "init" | "guide" | "ready";
  instruction: string;
  checks: DirectorCheck[];
  composition: "POOR" | "IMPROVING" | "GOOD" | "EXCELLENT";
  /** ready-hold progress 0..1 during final lock */
  holdProgress: number;
  /** expression-phase dwell progress 0..1 while EXPR is the pending check */
  exprProgress: number | null;
  /** seconds elapsed without a satisfying composition (for SKIP) */
  waitSecs: number;
}

export interface PortraitReadiness {
  framing: string;
  lighting: string;
  visibility: string;
  angle: string;
  stability: string;
  occlusion: string;
  overall: string; // PORTRAIT READY / GOOD / MODERATE
}

export interface DirectorResult {
  /** the captured portrait (real candidate from BestFrameEngine) */
  frame: BestFrameResult | null;
  readiness: PortraitReadiness;
  targetView: string;
  achievedView: string;
  lightingCoach: { before: string; after: string } | null;
  aura: string[];
  expression: {
    /** visual dynamics descriptor — NATURAL / SUBTLE / DYNAMIC (no emotion labels) */
    label: string;
    /** how settled the expression was at capture — HIGH / MEDIUM / LOW */
    stability: string;
    motion: string;
    eye: string;
    lip: string;
  } | null;
}

// ---------------------------------------------------------------------------
// V7 — Expression Lab
// ---------------------------------------------------------------------------

/** Per-region normalized geometric displacement vs. neutral baseline. */
export interface ExpressionVector {
  brow: number;
  eyes: number;
  nose: number;
  mouth: number;
  cheeks: number;
  jaw: number;
  silhouette: number;
  overall: number;
}

export interface LabChallengeResult {
  id: string;
  label: string;
  vector: ExpressionVector;
}

/** Live UI state pushed by the ExpressionLabEngine each frame. */
export interface ExpressionLabUI {
  phase: "baseline" | "prompt" | "capture";
  instruction: string;
  challengeLabel: string | null;
  challengeIndex: number;
  challengeTotal: number;
  holdProgress: number;
  vector: ExpressionVector | null;
  /** frozen neutral reference — renderer draws baseline→current vectors */
  baseline: Landmark[] | null;
}

export interface ExpressionLabResult {
  challenges: LabChallengeResult[];
  /** per-region peak response across the session */
  aggregate: ExpressionVector;
  /** qualitative, derived from aggregate.overall */
  responseLabel: string;
  baseline: Landmark[] | null;
  lastLandmarks: Landmark[] | null;
}

// ---------------------------------------------------------------------------
// V8 — Aura Duo
// ---------------------------------------------------------------------------

/** A tracked subject in Duo mode — render + synchrony data. */
export interface DuoSubject {
  landmarks: Landmark[] | null;
  boundingBox: BoundingBox | null;
  cx: number;
  cy: number;
  yawDeg: number;
  gazeDx: number;
  gazeDy: number;
  energy: number;
  present: boolean;
}

export interface DuoSync {
  head: number;
  gaze: number;
  motion: number;
  overall: number;
}

export interface DuoUI {
  count: number;
  lockProgress: number;
  sync: DuoSync | null;
}

export interface DuoResult {
  sync: DuoSync;
  subjects: {
    landmarks: Landmark[] | null;
    boundingBox: BoundingBox | null;
  }[];
}

// ---------------------------------------------------------------------------
// V7.2–V7.4 — Free Expression Lab / Motion Timeline / Motion Signature
// ---------------------------------------------------------------------------

export type LabEventKind =
  | "GAZE SHIFT"
  | "MOUTH RESPONSE"
  | "BROW RESPONSE"
  | "HEAD TURN"
  | "MOTION PEAK"
  | "FIELD STABLE";

/** One recorded timeline sample (~12 Hz while Free Lab is active). */
export interface TimelineSample {
  t: number; // ms since Free Lab session start
  regions: {
    brow: number;
    eyes: number;
    nose: number;
    mouth: number;
    cheeks: number;
    jaw: number;
  };
  pose: { yaw: number; pitch: number; roll: number };
  gaze: { dx: number; dy: number };
  motion: number; // overall facial-motion magnitude 0..1
  events: LabEventKind[]; // events fired at this sample
}

/** Live UI state pushed by the FreeLabEngine each frame. */
export interface FreeLabUI {
  phase: "baseline" | "active" | "stable" | "frozen";
  instruction: string;
  holdProgress: number; // baseline acquisition 0..1
  regions: ExpressionVector | null; // smoothed live activity
  poseMoving: boolean;
  baseline: Landmark[] | null;
  /** recent fired events (label + timestamp), newest last */
  recentEvents: { label: LabEventKind; at: number }[];
  durationMs: number;
  samples: number;
}

/** Derived deterministic artifact data built from a timeline. */
export interface MotionSignatureData {
  regionPeak: Record<keyof TimelineSample["regions"], number>;
  regionMean: Record<keyof TimelineSample["regions"], number>;
  peakRegion: string;
  eventCount: number;
  durationMs: number;
  activeMs: number;
  rhythm: string; // CONTINUOUS / INTERMITTENT / BURSTY
  /** decimated overall-motion waveform (~160 points) for hero + card */
  series: Float32Array;
  baseline: Landmark[] | null;
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
  /** Analysis progress 0..1 while state === "analysis". */
  scanProgress: number;
  /** Guided analysis UI info while analysis. */
  scan: ScanPhaseUI | null;
  /** Symmetry field (per-landmark deviation 0..1) for the mirror ghost. */
  symmetryField: Float32Array | null;
  /** Candidate history strip (last ~9 evaluations). */
  frameCandidates: { quality: number; isBest: boolean }[];
  /** Total candidates evaluated this pass. */
  frameCandidateNo: number;
  /** Best candidate quality 0..100. */
  bestFrameQuality: number;
  /** Timestamp of last "new best" event (ms) for the flash animation. */
  newBestAt: number;
  /** Frozen selected frame once the FRAME phase completes. */
  optimalFrame: BestFrameResult | null;
  /** V6 Director Mode live UI state. */
  director: DirectorUI | null;
  /** V6 Director Mode completed result. */
  directorResult: DirectorResult | null;
  /** V7 Expression Lab UI state while in lab mode. */
  lab: ExpressionLabUI | null;
  /** V7 Expression Lab completed result. */
  labResult: ExpressionLabResult | null;
  /** V8 Aura Duo UI state while in duo mode. */
  duo: DuoUI | null;
  /** V8 Aura Duo tracked subjects A/B for the renderer. */
  duoSubjects: (DuoSubject | null)[] | null;
  /** V8 Aura Duo completed result. */
  duoResult: DuoResult | null;
  /** V7.2 Free Lab UI state while in freelab mode. */
  freeLab: FreeLabUI | null;
  /** V7.3 latest recorded motion timeline (frozen session snapshot). */
  motionTimeline: TimelineSample[] | null;
  /** Latest analysis report (valid in "complete" state). */
  report: AnalysisReport | null;
}
