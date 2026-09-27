import type { CameraError } from "@/types/vision";

export interface CameraHandle {
  stream: MediaStream;
  video: HTMLVideoElement;
  facingMode: "user" | "environment";
}

export function cameraErrorFrom(err: unknown): CameraError {
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "permission-denied";
      case "NotFoundError":
      case "OverconstrainedError":
        return "no-camera";
      case "NotReadableError":
        return "disconnected";
      default:
        return "unknown";
    }
  }
  return "unknown";
}

export function isCameraSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window !== "undefined" &&
    window.isSecureContext
  );
}

/**
 * Acquire the default user-facing camera. 720p is enough detail for the
 * face mesh and keeps inference cost low on integrated GPUs.
 *
 * If `target` is supplied the stream is attached to that element so the
 * same <video> serves both display and inference — no frame copies.
 */
export async function acquireCamera(
  target?: HTMLVideoElement,
  facingMode: "user" | "environment" = "user",
): Promise<CameraHandle> {
  if (!isCameraSupported()) {
    throw Object.assign(new Error("unsupported"), { name: "NotSupported" });
  }

  // `ideal` (not `exact`) so devices without a rear camera fall back
  // gracefully instead of throwing OverconstrainedError.
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 60 },
    },
    audio: false,
  });

  const video = target ?? document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("autoplay", "");
  // iOS Safari requires a user-gesture-adjacent play sometimes; the
  // attribute + play() call handles the common cases.
  await video.play();

  return { stream, video, facingMode };
}

export function releaseCamera(handle: CameraHandle | null): void {
  if (!handle) return;
  for (const track of handle.stream.getTracks()) track.stop();
  handle.video.srcObject = null;
}
