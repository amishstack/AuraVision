export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export type TrackingState =
  | "boot"        // model / wasm loading
  | "idle"        // camera starting
  | "searching"   // camera live, no face
  | "detected"    // face seen this frame, landmarks initializing
  | "tracking"    // landmarks flowing
  | "locked"      // sustained stable tracking
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

export interface ExpressionSignals {
  blinkLeft: number;   // 0..1
  blinkRight: number;  // 0..1
  smile: number;       // 0..1
  mouthOpen: number;   // 0..1
}

export interface FrameMetrics {
  fps: number;
  inferenceMs: number;
  landmarkCount: number;
  facesDetected: number;
  confidence: number;   // 0..1 tracking confidence heuristic
  stability: number;    // 0..1 smoothed-landmark stability
}

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Mutable per-frame store written by the tracking loop and read by the
 * render + telemetry layers. Kept outside React state on purpose so the
 * ~60Hz pipeline never triggers React re-renders.
 */
export interface TrackingFrame {
  state: TrackingState;
  cameraError: CameraError | null;
  landmarks: Landmark[] | null;        // smoothed, normalized coords
  rawLandmarks: Landmark[] | null;     // unsmoothed, for debug
  pose: HeadPose | null;
  expression: ExpressionSignals | null;
  metrics: FrameMetrics;
  boundingBox: BoundingBox | null;
  framesWithFace: number;
  mirrored: boolean;
}
