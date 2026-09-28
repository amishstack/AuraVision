"use client";

import { useRef, useState, type MutableRefObject } from "react";
import SignatureMesh from "@/components/visualization/SignatureMesh";
import CameraGeometryBlend from "@/components/visualization/CameraGeometryBlend";
import type { AnalysisReport, TrackingFrame } from "@/types/vision";

/**
 * Visual Signature — the Deep Analysis artifact. Rotating merged
 * geometry as hero, qualitative attributes, palette, vibe, blend slider,
 * native share. All values derived from real analysis; the aesthetic
 * composite is explicitly labeled experimental.
 */
export default function VisualSignature({
  report,
  frame,
  videoRef,
  onClose,
}: {
  report: AnalysisReport;
  frame: MutableRefObject<TrackingFrame>;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  onClose: () => void;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const share = async () => {
    try {
      const canvas = cardRef.current?.querySelector("canvas");
      if (
        canvas &&
        navigator.canShare &&
        (await new Promise<boolean>((resolve) => {
          canvas.toBlob(
            (b) =>
              resolve(!!b && navigator.canShare({ files: [new File([b], "s.png", { type: "image/png" })] })),
            "image/png",
          );
        }))
      ) {
        canvas.toBlob(async (b) => {
          if (!b) return;
          await navigator.share({
            files: [new File([b], "auravision-signature.png", { type: "image/png" })],
            title: "AuraVision",
            text: "Visual Signature — monocular facial reconstruction",
          });
        }, "image/png");
        return;
      }
      await navigator.share({
        title: "AuraVision",
        text: `Visual Signature — experimental visual metric ${report.aesthetic.total} · ${report.vibe.join(" / ")}`,
      });
    } catch {
      // user cancelled or share unsupported — silent
    }
  };

  const a = report.aesthetic;

  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-[#0b0d0e]/95 animate-[fadeIn_0.6s_ease-out]">
      <div
        ref={cardRef}
        className="mx-auto flex min-h-full w-full max-w-sm flex-col items-center px-6 py-6 font-mono tracking-[0.15em]"
      >
        <div className="text-[10px] tracking-[0.3em] text-neutral-600">
          AURAVISION
        </div>
        <div className="mt-3 text-sm tracking-[0.35em] text-neutral-100">
          VISUAL SIGNATURE
        </div>
        <div className="mt-1 text-[9px] tracking-[0.25em] text-neutral-600">
          MONOCULAR RGB — BROWSER-SIDE ANALYSIS
        </div>

        {/* hero */}
        <div className="my-5">
          <SignatureMesh points={report.signaturePoints} size={230} />
        </div>

        {/* experimental aesthetic metric */}
        <div className="w-full border-t border-neutral-800 pt-4">
          <button
            onClick={() => setShowInfo((v) => !v)}
            className="flex w-full items-baseline justify-between"
          >
            <span className="text-[9px] tracking-[0.25em] text-neutral-600">
              VISUAL AESTHETIC — EXPERIMENTAL ⓘ
            </span>
            <span className="text-2xl tracking-[0.1em] text-neutral-100 tabular-nums">
              {a.total}
            </span>
          </button>
          {showInfo && (
            <p className="mt-2 text-[9px] leading-4 tracking-normal text-neutral-500">
              Experimental visual-composition metric computed from measurable
              image and geometry characteristics — symmetry, proportions,
              framing, lighting. Not an objective measure of appearance.
            </p>
          )}
          <div className="mt-3 space-y-1 text-[10px]">
            {(
              [
                ["SYMMETRY", a.symmetry],
                ["PROPORTION", a.proportion],
                ["BALANCE", a.balance],
                ["FRAMING", a.framing],
                ["LIGHTING", a.lighting],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between">
                <span className="text-neutral-600">{k}</span>
                <span className="flex items-center gap-2">
                  <span className="h-px w-16 bg-neutral-800">
                    <span
                      className="block h-px bg-neutral-400"
                      style={{ width: `${v}%` }}
                    />
                  </span>
                  <span className="w-6 text-right text-neutral-300 tabular-nums">
                    {v}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* attributes */}
        <div className="mt-5 grid w-full grid-cols-2 gap-x-6 gap-y-4 text-[10px]">
          <Attr title="SYMMETRY" value={report.symmetryLabel} />
          <Attr title="PROPORTION" value={report.proportionLabel} />
          <Attr
            title="GAZE"
            value={`${report.gaze.stabilityLabel} STABILITY`}
          />
          <Attr title="LIGHTING" value={report.lighting.label} />
          <Attr title="PREFERRED VIEW" value={report.preferredView} />
          <Attr title="DYNAMICS" value={report.dynamicsLabel} />
        </div>

        {report.compositionLabel && (
          <div className="mt-4 w-full border-t border-neutral-800 pt-3 text-[9px] tracking-[0.2em] text-neutral-400">
            COMPOSITIONAL — {report.compositionLabel}
          </div>
        )}

        {/* palette */}
        {report.palette && (
          <div className="mt-5 w-full border-t border-neutral-800 pt-4">
            <div className="mb-2 text-[9px] tracking-[0.25em] text-neutral-600">
              VISUAL PALETTE
            </div>
            <div className="flex items-center gap-2">
              {report.palette.colors.map((c) => (
                <span
                  key={c}
                  className="h-5 w-5 rounded-sm border border-neutral-800"
                  style={{ background: c }}
                />
              ))}
              <span className="ml-2 text-[9px] text-neutral-500">
                {report.palette.temperature} · {report.palette.contrastLabel}
              </span>
            </div>
          </div>
        )}

        {/* vibe */}
        <div className="mt-5 w-full border-t border-neutral-800 pt-4">
          <div className="mb-1 text-[9px] tracking-[0.25em] text-neutral-600">
            VISUAL VIBE — PLAYFUL INTERPRETATION
          </div>
          <div className="text-[13px] tracking-[0.3em] text-neutral-200">
            {report.vibe.join("  /  ")}
          </div>
        </div>

        {/* lighting suggestions */}
        {report.lighting.suggestions.length > 0 && (
          <div className="mt-5 w-full border-t border-neutral-800 pt-4 text-[9px] leading-5 tracking-[0.2em] text-neutral-500">
            {report.lighting.suggestions.map((s) => (
              <div key={s}>→ {s}</div>
            ))}
          </div>
        )}

        {/* camera ⇄ geometry */}
        <div className="mt-6 flex w-full flex-col items-center border-t border-neutral-800 pt-4">
          <div className="mb-3 text-[9px] tracking-[0.25em] text-neutral-600">
            CAMERA ⇄ GEOMETRY
          </div>
          <CameraGeometryBlend frame={frame} videoRef={videoRef} size={200} />
        </div>

        <div className="mt-6 w-full border-t border-neutral-800 pt-3 text-center text-[9px] leading-5 tracking-[0.2em] text-neutral-600">
          {report.landmarkCount} LANDMARKS · {report.viewsCaptured} VIEWS ·
          LOCAL ONLY
        </div>

        <div className="mt-5 flex w-full gap-3 pb-4">
          <button
            onClick={share}
            className="flex-1 rounded border border-neutral-700 py-2.5 text-[11px] tracking-[0.25em] text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
          >
            SHARE
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded border border-neutral-700 py-2.5 text-[11px] tracking-[0.25em] text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
          >
            LIVE
          </button>
        </div>
      </div>
    </div>
  );
}

function Attr({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <div className="mb-0.5 text-[8px] tracking-[0.25em] text-neutral-600">
        {title}
      </div>
      <div className="text-neutral-200">{value}</div>
    </div>
  );
}
