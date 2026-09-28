"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalysisReport, DirectorResult as DirectorResultT } from "@/types/vision";
import { useFaceTracking } from "@/lib/tracking/useFaceTracking";
import { useTelemetry } from "@/lib/tracking/useTelemetry";
import CameraFeed from "@/components/camera/CameraFeed";
import FaceMeshOverlay from "@/components/face/FaceMeshOverlay";
import SystemInterface from "@/components/ui/SystemInterface";
import DebugPanel from "@/components/ui/DebugPanel";
import VisualSignature from "@/components/scan/VisualSignature";
import DirectorOverlay from "@/components/director/DirectorOverlay";
import DirectorResult from "@/components/results/DirectorResult";

export default function AuraVisionApp() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [session, setSession] = useState(0);
  const [debug, setDebug] = useState(false);
  const [demo, setDemo] = useState(false);
  // live-view override — reset automatically when a new optimal frame arrives
  const [liveForImage, setLiveForImage] = useState<string | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const { frameRef, startDeepScan, startDirector, directorSkip, exitProfile } =
    useFaceTracking(videoRef, session, facing);
  const snap = useTelemetry(frameRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "d" || e.key === "D") setDebug((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // live view applies only to the current optimal frame selection
  const optimalImage = snap.optimalFrame?.image ?? null;
  const optimalLive = liveForImage !== null && liveForImage === optimalImage;

  // --- session-lifetime analysis result --------------------------------
  // Completed reports persist in memory until a new scan starts or the
  // page is reloaded. Stored on the 'complete' state-transition only.
  const [savedReport, setSavedReport] = useState<AnalysisReport | null>(null);
  const [savedDirector, setSavedDirector] = useState<DirectorResultT | null>(null);
  const [viewingSaved, setViewingSaved] = useState(false);
  const [viewingDirector, setViewingDirector] = useState(false);
  const [fun, setFun] = useState(false);
  const [wasComplete, setWasComplete] = useState(false);
  if (snap.state === "complete" && !wasComplete) {
    setWasComplete(true);
    if (snap.report) setSavedReport(snap.report);
    if (snap.directorResult) setSavedDirector(snap.directorResult);
  } else if (snap.state !== "complete" && wasComplete) {
    setWasComplete(false);
  }

  const showResult =
    (snap.state === "complete" && (snap.report || snap.directorResult)) ||
    (viewingSaved && savedReport) ||
    (viewingDirector && savedDirector);
  const activeReport =
    snap.state === "complete" && snap.report
      ? snap.report
      : viewingSaved
        ? savedReport
        : null;
  const activeDirector =
    snap.state === "complete" && snap.directorResult
      ? snap.directorResult
      : viewingDirector
        ? savedDirector
        : null;
  const canViewResult =
    !!savedReport && snap.state !== "complete" && !showResult;
  const canViewPortrait =
    !!savedDirector && snap.state !== "complete" && !showResult;

  const closeResult = () => {
    setViewingSaved(false);
    setViewingDirector(false);
    if (snap.state === "complete") exitProfile();
  };
  const beginAnalysis = () => {
    setSavedReport(null);
    setViewingSaved(false);
    setViewingDirector(false);
    startDeepScan();
  };
  const beginDirector = () => {
    setSavedDirector(null);
    setViewingSaved(false);
    setViewingDirector(false);
    startDirector();
  };

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
          <div className="mt-0.5 hidden font-mono text-[9px] font-medium tracking-[0.25em] text-neutral-500 sm:block">
            VISUAL PRESENCE LAB
          </div>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          <span className="hidden font-mono text-[10px] tracking-[0.2em] text-neutral-600 sm:inline">
            LOCAL PROCESSING — NO UPLOAD
          </span>
          {canScan && (
            <>
              <button
                onClick={beginAnalysis}
                className={`font-mono font-medium tracking-[0.2em] transition-colors hover:text-cyan-200 ${
                  demo
                    ? "rounded border border-neutral-600 px-4 py-2 text-[11px] text-neutral-100"
                    : "text-[11px] text-neutral-200"
                }`}
              >
                DEEP ANALYSIS
              </button>
              <button
                onClick={beginDirector}
                className={`font-mono font-medium tracking-[0.2em] transition-colors hover:text-cyan-200 ${
                  demo
                    ? "rounded border border-neutral-600 px-4 py-2 text-[11px] text-neutral-100"
                    : "text-[11px] text-neutral-200"
                }`}
              >
                DIRECTOR
              </button>
            </>
          )}
          {canViewResult && (
            <button
              onClick={() => setViewingSaved(true)}
              className="font-mono text-[10px] font-medium tracking-[0.2em] text-neutral-400 transition-colors hover:text-neutral-200"
            >
              RESULT
            </button>
          )}
          {canViewPortrait && (
            <button
              onClick={() => setViewingDirector(true)}
              className="font-mono text-[10px] font-medium tracking-[0.2em] text-neutral-400 transition-colors hover:text-neutral-200"
            >
              PORTRAIT
            </button>
          )}
          {!demo && (
            <button
              onClick={() => setFun((v) => !v)}
              className={`font-mono text-[10px] font-medium tracking-[0.2em] transition-colors ${
                fun ? "text-cyan-300" : "text-neutral-600 hover:text-neutral-400"
              }`}
            >
              FUN
            </button>
          )}
          {!demo && (
            <button
              onClick={() =>
                setFacing((f) => (f === "user" ? "environment" : "user"))
              }
              className="font-mono text-[10px] tracking-[0.2em] text-neutral-600 transition-colors hover:text-neutral-300"
              aria-label="Switch camera"
            >
              {mirrored ? "REAR CAM" : "FRONT CAM"}
            </button>
          )}
          <button
            onClick={() => setDemo((v) => !v)}
            className={`font-mono text-[10px] tracking-[0.2em] transition-colors ${
              demo ? "text-cyan-300" : "text-neutral-600 hover:text-neutral-400"
            }`}
          >
            {demo ? "EXIT DEMO" : "DEMO"}
          </button>
          {!demo && (
            <button
              onClick={() => setDebug((v) => !v)}
              className={`font-mono text-[10px] tracking-[0.2em] transition-colors ${
                debug ? "text-cyan-300" : "text-neutral-600 hover:text-neutral-400"
              }`}
            >
              DEBUG
            </button>
          )}
        </div>
      </header>

      {/* viewport — taller aspect on portrait phones */}
      <div className="flex flex-1 items-center justify-center px-3 pb-4 sm:px-6 sm:pb-6">
        <div className="relative aspect-[3/4] w-full max-w-5xl overflow-hidden rounded-md border border-neutral-800/80 bg-black sm:aspect-video">
          <CameraFeed videoRef={videoRef} mirrored={mirrored} />
          <FaceMeshOverlay
            frame={frameRef}
            videoRef={videoRef}
            debug={debug}
            fun={fun}
          />

          {/* subtle viewport frame */}
          <div className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-inset ring-white/[0.04]" />

          {/* searching-state center reticle */}
          {(snap.state === "searching" || snap.state === "boot") && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-16 w-16 rounded-full border border-neutral-700/50" />
            </div>
          )}

          {/* director HUD */}
          <DirectorOverlay snap={snap} fun={fun} onSkip={directorSkip} />

          {/* optimal-frame freeze — the actual captured candidate */}
          {snap.state === "analysis" && snap.optimalFrame && (
            <div className="absolute inset-0 animate-[fadeIn_0.4s_ease-out]">
              {!optimalLive && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={snap.optimalFrame.image}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute left-3 top-9 font-mono text-[9px] tracking-[0.25em] sm:left-4 sm:top-10">
                    <div className="text-neutral-200">OPTIMAL FRAME</div>
                    <div className="mt-0.5 text-neutral-500">
                      FRAME SELECTED — QUALITY {snap.bestFrameQuality}%
                    </div>
                    <div className="mt-2 space-y-0.5 text-[8px] tracking-[0.2em] text-neutral-500">
                      <div>LIGHTING&nbsp;&nbsp;{qual(snap.optimalFrame.parts.lighting)}</div>
                      <div>FRAMING&nbsp;&nbsp;&nbsp;{qual(snap.optimalFrame.parts.framing)}</div>
                      <div>ANGLE&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{snap.optimalFrame.angleLabel}</div>
                      <div>STABILITY&nbsp;{qual(snap.optimalFrame.parts.steadiness)}</div>
                      <div>OCCLUSION&nbsp;{qual(100 - snap.optimalFrame.parts.visibility)}</div>
                    </div>
                  </div>
                </>
              )}
              <button
                onClick={() =>
                  setLiveForImage((v) =>
                    v === optimalImage ? null : optimalImage,
                  )
                }
                className="absolute bottom-3 left-1/2 min-h-11 -translate-x-1/2 rounded border border-neutral-700 bg-black/60 px-5 font-mono text-[10px] tracking-[0.25em] text-neutral-200 backdrop-blur transition-colors hover:border-neutral-500"
              >
                {optimalLive ? "OPTIMAL FRAME" : "LIVE"}
              </button>
            </div>
          )}

          {/* Layer C — system interface (hidden while a result owns the viewport) */}
          {!showResult && <SystemInterface snap={snap} debug={debug} fun={fun} />}

          {/* debug — top right inside viewport */}
          {debug && (
            <div className="absolute right-3 top-9 w-56 sm:right-4 sm:top-10">
              <DebugPanel snap={snap} />
            </div>
          )}

          {/* results — visual signature or director portrait */}
          {showResult && activeReport && !activeDirector && (
            <VisualSignature
              report={activeReport}
              frame={frameRef}
              videoRef={videoRef}
              fun={fun}
              onClose={closeResult}
            />
          )}
          {showResult && activeDirector && (
            <DirectorResult
              result={activeDirector}
              frame={frameRef}
              fun={fun}
              onLive={closeResult}
              onDeepAnalysis={beginAnalysis}
            />
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
      {!demo && (
        <footer className="flex items-center justify-between px-4 pb-3 font-mono text-[10px] font-medium tracking-[0.12em] text-neutral-500 sm:px-6 sm:pb-4 sm:tracking-[0.2em]">
          <span>MONOCULAR RGB — BROWSER-SIDE INFERENCE</span>
          <span>
            {snap.state === "locked" ? "GEOMETRY LOCK" : snap.state.toUpperCase()}
          </span>
        </footer>
      )}
    </main>
  );
}

function qual(v: number): string {
  if (v >= 85) return "EXCELLENT";
  if (v >= 65) return "GOOD";
  if (v >= 45) return "MODERATE";
  return "LOW";
}
