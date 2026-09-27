"use client";

import type { MutableRefObject } from "react";

/**
 * The visible camera element. The same <video> is used by the tracking
 * loop for inference — a single element, zero frame copies.
 * Front camera is mirrored via CSS so it behaves like a natural preview;
 * the rear camera renders unmirrored.
 */
export default function CameraFeed({
  videoRef,
  mirrored,
}: {
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  mirrored: boolean;
}) {
  return (
    <video
      ref={videoRef}
      muted
      playsInline
      autoPlay
      className="absolute inset-0 h-full w-full object-cover"
      style={{ transform: mirrored ? "scaleX(-1)" : "none" }}
    />
  );
}
