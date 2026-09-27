import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";

/**
 * MediaPipe FaceLandmarker wrapper.
 *
 * - WASM runtime + model are served from /public so nothing is fetched
 *   from a CDN at runtime — everything stays local.
 * - GPU delegate first (WebGL-backed, fast on Iris Xe), CPU fallback.
 * - We request facial transformation matrices (head pose) and face
 *   blendshapes (expression signals) in the same inference pass.
 * - numFaces = 2 so we can detect "multiple faces" and pick the most
 *   prominent one, per the V1 spec.
 */

const WASM_BASE = "/mediapipe/wasm";
const MODEL_URL = "/mediapipe/models/face_landmarker.task";

export { FaceLandmarker };
export type { FaceLandmarkerResult };

let instance: FaceLandmarker | null = null;
let loading: Promise<FaceLandmarker> | null = null;

async function create(delegate: "GPU" | "CPU"): Promise<FaceLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numFaces: 2,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
}

export async function loadFaceLandmarker(): Promise<FaceLandmarker> {
  if (instance) return instance;
  if (loading) return loading;

  loading = (async () => {
    try {
      instance = await create("GPU");
    } catch {
      // Integrated GPUs occasionally reject the delegate — retry on CPU.
      instance = await create("CPU");
    }
    return instance;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

export function disposeFaceLandmarker(): void {
  instance?.close();
  instance = null;
}
