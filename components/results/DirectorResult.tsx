"use client";

import { useState } from "react";
import OptimalFrame from "@/components/results/OptimalFrame";
import { portraitArtifactBlob } from "@/lib/visualization/portraitArtifact";
import type { DirectorResult as Result, TrackingFrame } from "@/types/vision";
import type { MutableRefObject } from "react";

/**
 * Director result — optimal portrait + readiness + aura.
 * Composition assessment only; no appearance judgment.
 */
export default function DirectorResult({
  result,
  frame,
  fun,
  onLive,
  onDeepAnalysis,
}: {
  result: Result;
  frame: MutableRefObject<TrackingFrame>;
  fun: boolean;
  onLive: () => void;
  onDeepAnalysis: () => void;
}) {
  const [sharing, setSharing] = useState(false);

  const share = async () => {
    setSharing(true);
    try {
      const blob = await portraitArtifactBlob(result);
      const file = blob
        ? new File([blob], "auravision-portrait.png", { type: "image/png" })
        : null;
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "AuraVision",
          text: "Portrait Ready — optimized camera composition",
        });
      } else if (navigator.share) {
        await navigator.share({
          title: "AuraVision",
          text: `PORTRAIT READY — ${result.readiness.overall} · ${result.aura.join(" / ")}`,
        });
      }
    } catch {
      // cancelled/unsupported
    } finally {
      setSharing(false);
    }
  };

  const r = result.readiness;

  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-[#0b0d0e] animate-[fadeIn_0.6s_ease-out]">
      <div className="mx-auto flex min-h-full w-full max-w-sm flex-col items-center px-6 py-6 font-mono tracking-[0.15em]">
        <div className="text-[10px] tracking-[0.3em] text-neutral-500">
          AURAVISION
        </div>
        <div className="mt-3 text-[11px] font-medium tracking-[0.35em] text-neutral-100">
          DIRECTOR RESULT
        </div>
        <div className="mt-3 text-sm font-medium tracking-[0.3em] text-cyan-200/90">
          PORTRAIT READY
        </div>
        <div className="mt-1 text-[9px] tracking-[0.25em] text-neutral-500">
          OPTIMAL CAMERA COMPOSITION
        </div>

        {/* captured portrait — hero */}
        {result.frame && (
          <div className="my-6 w-full">
            <OptimalFrame best={result.frame} mirrored={frame.current.mirrored} />
          </div>
        )}

        {/* portrait readiness */}
        <div className="w-full border-t border-neutral-800 pt-4">
          <div className="mb-2 text-[9px] tracking-[0.25em] text-neutral-500">
            PORTRAIT READINESS — {r.overall}
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[10px]">
            <Attr title="FRAMING" value={r.framing} />
            <Attr title="LIGHTING" value={r.lighting} />
            <Attr title="ANGLE" value={result.achievedView} />
            <Attr title="STABILITY" value={r.stability} />
            <Attr title="VISIBILITY" value={r.visibility} />
            <Attr title="OCCLUSION" value={r.occlusion} />
          </div>
        </div>

        {result.lightingCoach && (
          <div className="mt-4 w-full border-t border-neutral-800 pt-3 text-[10px]">
            <div className="mb-1 text-[9px] tracking-[0.25em] text-neutral-500">
              LIGHTING COACH
            </div>
            <div className="text-neutral-300">
              BEFORE {result.lightingCoach.before} → AFTER{" "}
              {result.lightingCoach.after}
            </div>
          </div>
        )}

        {result.expression && (
          <div className="mt-4 w-full border-t border-neutral-800 pt-3">
            <div className="mb-2 text-[9px] tracking-[0.25em] text-neutral-500">
              EXPRESSION DYNAMICS
            </div>
            <div className="grid grid-cols-3 gap-3 text-[10px]">
              <Attr title="MOTION" value={result.expression.motion} />
              <Attr title="EYE" value={result.expression.eye} />
              <Attr title="LIP" value={result.expression.lip} />
            </div>
          </div>
        )}

        {/* visual aura */}
        <div className="mt-5 w-full border-t border-neutral-800 pt-4">
          <div className="mb-1 text-[9px] tracking-[0.25em] text-neutral-500">
            VISUAL AURA — PLAYFUL INTERPRETATION
          </div>
          <div className="text-[13px] tracking-[0.3em] text-cyan-200/90">
            {result.aura.join("  /  ")}
          </div>
        </div>

        <div className="mt-6 w-full border-t border-neutral-800 pt-3 text-center text-[9px] leading-5 tracking-[0.2em] text-neutral-500">
          MONOCULAR RGB — BROWSER-SIDE ANALYSIS
          <br />
          LOCAL ONLY · NO UPLOAD
          {fun && (
            <>
              <br />
              <span className="text-cyan-200/70">CAMERA LOVES THIS ANGLE</span>
            </>
          )}
        </div>

        <div className="mt-5 grid w-full grid-cols-2 gap-3 pb-6">
          <button
            onClick={onDeepAnalysis}
            className="min-h-11 rounded border border-neutral-700 py-2.5 text-[10px] tracking-[0.2em] text-neutral-300 transition-colors hover:border-neutral-500"
          >
            DEEP ANALYSIS
          </button>
          <button
            onClick={share}
            disabled={sharing}
            className="min-h-11 rounded border border-neutral-700 py-2.5 text-[10px] tracking-[0.2em] text-neutral-200 transition-colors hover:border-neutral-500 disabled:opacity-50"
          >
            {sharing ? "…" : "SHARE PORTRAIT"}
          </button>
          <button
            onClick={onLive}
            className="min-h-11 col-span-2 rounded border border-neutral-700 py-2.5 text-[10px] tracking-[0.2em] text-neutral-300 transition-colors hover:border-neutral-500"
          >
            BACK TO LIVE
          </button>
        </div>
      </div>
    </div>
  );
}

function Attr({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <div className="mb-0.5 text-[8px] tracking-[0.2em] text-neutral-500">
        {title}
      </div>
      <div className="text-neutral-200">{value}</div>
    </div>
  );
}
