"use client";

import { useEffect, useState, type MutableRefObject } from "react";
import type { TrackingFrame } from "@/types/vision";

/**
 * Polls the mutable TrackingFrame at a low cadence (~10 Hz) and returns
 * a snapshot for React UI. The render path itself never goes through
 * React — only these cheap telemetry reads do.
 */
export function useTelemetry(
  frame: MutableRefObject<TrackingFrame>,
  hz = 10,
): TrackingFrame {
  const [snap, setSnap] = useState<TrackingFrame>(frame.current);

  useEffect(() => {
    const id = setInterval(() => {
      const f = frame.current;
      setSnap({
        ...f,
        metrics: { ...f.metrics },
        pose: f.pose ? { ...f.pose } : null,
        gaze: f.gaze ? { ...f.gaze } : null,
        dynamics: f.dynamics ? { ...f.dynamics } : null,
        lighting: f.lighting ? { ...f.lighting } : null,
        depth: f.depth ? { ...f.depth } : null,
        boundingBox: f.boundingBox ? { ...f.boundingBox } : null,
        profile: f.profile ? { ...f.profile } : null,
      });
    }, 1000 / hz);
    return () => clearInterval(id);
  }, [frame, hz]);

  return snap;
}
