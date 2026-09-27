"use client";

import { useEffect, useRef, useState } from "react";
import { useFaceTracking } from "@/lib/tracking/useFaceTracking";
import { useTelemetry } from "@/lib/tracking/useTelemetry";
import CameraFeed from "@/components/camera/CameraFeed";
import FaceMeshOverlay from "@/components/face/FaceMeshOverlay";
import StatusPanel from "@/components/ui/StatusPanel";
import DebugPanel from "@/components/ui/DebugPanel";

export default function AuraVisionApp() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [session, setSession] = useState(0);
  const [debug, setDebug] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const { frameRef } = useFaceTracking(videoRef, session, facing);
  const snap = useTelemetry(frameRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "d" || e.key === "D") setDebug((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isError = snap.state === "error";
  const mirrored = facing === "user";

  return (
    <main className="relative flex h-dvh w-full flex-col overflow-hidden bg-[#0b0d0e] text-neutral-200">
      {/* header */}
      <header className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
        <div className="font-mono text-xs tracking-[0.3em] text-neutral-400">
          AURAVISION
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          <span className="hidden font-mono text-[10px] tracking-[0.2em] text-neutral-600 sm:inline">
            LOCAL PROCESSING — NO UPLOAD
          </span>
          <button
            onClick={() =>
              setFacing((f) => (f === "user" ? "environment" : "user"))
            }
            className="font-mono text-[10px] tracking-[0.2em] text-neutral-600 transition-colors hover:text-neutral-300"
            aria-label="Switch camera"
          >
            {mirrored ? "REAR CAM" : "FRONT CAM"}
          </button>
          <button
            onClick={() => setDebug((v) => !v)}
            className={`font-mono text-[10px] tracking-[0.2em] transition-colors ${
              debug ? "text-cyan-300" : "text-neutral-600 hover:text-neutral-400"
            }`}
          >
            DEBUG
          </button>
        </div>
      </header>

      {/* viewport — taller aspect on portrait phones */}
      <div className="flex flex-1 items-center justify-center px-3 pb-4 sm:px-6 sm:pb-6">
        <div className="relative aspect-[3/4] w-full max-w-5xl overflow-hidden rounded-md border border-neutral-800/80 bg-black sm:aspect-video">
          <CameraFeed videoRef={videoRef} mirrored={mirrored} />
          <FaceMeshOverlay frame={frameRef} videoRef={videoRef} debug={debug} />

          {/* subtle viewport frame */}
          <div className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-inset ring-white/[0.04]" />

          {/* searching-state center mark */}
          {(snap.state === "searching" || snap.state === "idle" || snap.state === "boot") && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-16 w-16 rounded-full border border-neutral-700/50" />
            </div>
          )}

          {/* telemetry — bottom left inside viewport */}
          <div className="absolute bottom-3 left-3 sm:bottom-4 sm:left-4">
            <StatusPanel snap={snap} />
          </div>

          {/* debug — top right inside viewport */}
          {debug && (
            <div className="absolute right-3 top-3 w-52 sm:right-4 sm:top-4 sm:w-56">
              <DebugPanel snap={snap} />
            </div>
          )}

          {/* error veil */}
          {isError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 px-6 text-center">
              <button
                onClick={() => setSession((s) => s + 1)}
                className="rounded border border-neutral-700 px-4 py-2 font-mono text-[11px] tracking-[0.2em] text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
              >
                RETRY
              </button>
            </div>
          )}
        </div>
      </div>

      {/* footer */}
      <footer className="flex items-center justify-between px-4 pb-3 font-mono text-[10px] tracking-[0.2em] text-neutral-700 sm:px-6 sm:pb-4">
        <span>FACIAL GEOMETRY — V1</span>
        <span>
          {snap.state === "locked" ? "GEOMETRY LOCK" : snap.state.toUpperCase()}
        </span>
      </footer>
    </main>
  );
}
