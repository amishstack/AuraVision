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
        expression: f.expression ? { ...f.expression } : null,
        boundingBox: f.boundingBox ? { ...f.boundingBox } : null,
      });
    }, 1000 / hz);
    return () => clearInterval(id);
  }, [frame, hz]);

  return snap;
}
