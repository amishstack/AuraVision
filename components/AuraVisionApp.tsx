"use client";

import { useEffect, useRef, useState } from "react";
import { useFaceTracking } from "@/lib/tracking/useFaceTracking";
import { useTelemetry } from "@/lib/tracking/useTelemetry";
import CameraFeed from "@/components/camera/CameraFeed";
import FaceMeshOverlay from "@/components/face/FaceMeshOverlay";
import SystemInterface from "@/components/ui/SystemInterface";
import DebugPanel from "@/components/ui/DebugPanel";
import VisualSignature from "@/components/scan/VisualSignature";

export default function AuraVisionApp() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [session, setSession] = useState(0);
  const [debug, setDebug] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const { frameRef, startDeepScan, exitProfile } = useFaceTracking(
    videoRef,
    session,
    facing,
  );
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
  const canScan = snap.state === "tracking" || snap.state === "locked";

  return (
    <main className="relative flex h-dvh w-full flex-col overflow-hidden bg-[#0b0d0e] text-neutral-200">
      {/* header */}
      <header className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
        <div>
          <div className="font-mono text-xs tracking-[0.3em] text-neutral-300">
            AURAVISION
          </div>
          <div className="mt-0.5 hidden font-mono text-[9px] tracking-[0.25em] text-neutral-600 sm:block">
            LIVE VISUAL INTELLIGENCE
          </div>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          <span className="hidden font-mono text-[10px] tracking-[0.2em] text-neutral-600 sm:inline">
            LOCAL PROCESSING — NO UPLOAD
          </span>
          {canScan && (
            <button
              onClick={startDeepScan}
              className="font-mono text-[10px] tracking-[0.2em] text-neutral-300 transition-colors hover:text-cyan-200"
            >
              DEEP SCAN
            </button>
          )}
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

          {/* searching-state center reticle */}
          {(snap.state === "searching" || snap.state === "boot") && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-16 w-16 rounded-full border border-neutral-700/50" />
            </div>
          )}

          {/* Layer C — system interface */}
          <SystemInterface snap={snap} debug={debug} />

          {/* debug — top right inside viewport */}
          {debug && (
            <div className="absolute right-3 top-9 w-56 sm:right-4 sm:top-10">
              <DebugPanel snap={snap} />
            </div>
          )}

          {/* visual signature */}
          {snap.state === "complete" && snap.profile && (
            <VisualSignature profile={snap.profile} onClose={exitProfile} />
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
        <span>MONOCULAR RGB — BROWSER-SIDE INFERENCE</span>
        <span>
          {snap.state === "locked" ? "GEOMETRY LOCK" : snap.state.toUpperCase()}
        </span>
      </footer>
    </main>
  );
}
