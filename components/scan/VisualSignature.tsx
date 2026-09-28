"use client";

import { useEffect, useState, type MutableRefObject } from "react";
import SignatureMesh from "@/components/visualization/SignatureMesh";
import AuraField from "@/components/visualization/AuraField";
import CameraGeometryBlend from "@/components/visualization/CameraGeometryBlend";
import OptimalFrame from "@/components/results/OptimalFrame";
import { artifactBlob } from "@/lib/visualization/artifact";
import type { AnalysisReport, TrackingFrame } from "@/types/vision";

/**
 * Visual Signature (V5) — the Deep Analysis artifact.
 * Hero reconstruction → presence → structural signature → gaze → palette
 * → aura profile → optimal frame → camera⇄geometry → share.
 * All values derived from real analysis; composites labeled experimental.
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
  const [sharing, setSharing] = useState(false);

  const share = async () => {
    setSharing(true);
    try {
      const blob = await artifactBlob(report);
      const file = blob
        ? new File([blob], "auravision-signature.png", { type: "image/png" })
        : null;
      if (
        file &&
        navigator.canShare?.({ files: [file] })
      ) {
        await navigator.share({
          files: [file],
          title: "AuraVision",
          text: "Visual Signature — monocular facial reconstruction",
        });
      } else if (navigator.share) {
        await navigator.share({
          title: "AuraVision",
          text: `VISUAL SIGNATURE — presence: ${report.presence.join(", ")} · aura: ${report.aura.join(", ")}`,
        });
      }
    } catch {
      // cancelled/unsupported — silent
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-[#0b0d0e]/95 animate-[fadeIn_0.6s_ease-out]">
      <div className="mx-auto flex min-h-full w-full max-w-sm flex-col items-center px-6 py-6 font-mono tracking-[0.15em]">
        <div className="text-[10px] tracking-[0.3em] text-neutral-600">
          AURAVISION
        </div>
        <div className="mt-3 text-sm tracking-[0.35em] text-neutral-100">
          VISUAL SIGNATURE
        </div>
        <div className="mt-1 text-[9px] tracking-[0.25em] text-neutral-600">
          MONOCULAR RGB — BROWSER-SIDE ANALYSIS
        </div>

        {/* hero — aura field behind the reconstruction */}
        <Section delay={0} className="my-5">
          <div className="relative">
            <div className="absolute inset-0 opacity-70">
              <AuraField report={report} size={300} />
            </div>
            <SignatureMesh points={report.signaturePoints} size={300} />
          </div>
          <div className="mt-2 text-center text-[9px] leading-4 tracking-[0.25em] text-neutral-600">
            MONOCULAR FACIAL RECONSTRUCTION
            <br />
            {report.landmarkCount} LANDMARKS · MULTI-VIEW · LOCAL ONLY
          </div>
        </Section>

        {/* visual presence */}
        <Section delay={80} className="w-full border-t border-neutral-800 pt-4">
          <Header text="VISUAL PRESENCE" sub="EXPERIMENTAL INTERPRETATION" />
          <div className="text-[15px] tracking-[0.3em] text-neutral-100">
            {report.presence.join("  /  ")}
          </div>
          <div className="mt-1 text-[9px] tracking-normal text-neutral-600">
            {report.presenceBasis.join(" · ")}
          </div>
        </Section>

        {/* structural signature */}
        <Section delay={160} className="w-full border-t border-neutral-800 pt-4">
          <button
            onClick={() => setShowInfo((v) => !v)}
            className="flex w-full items-baseline justify-between"
          >
            <Header text="STRUCTURAL SIGNATURE" sub="EXPERIMENTAL VISUAL METRIC ⓘ" />
            <CountUp value={report.aesthetic.total} className="text-3xl text-neutral-100" />
          </button>
          {showInfo && (
            <p className="mt-2 text-[9px] leading-4 tracking-normal text-neutral-500">
              Composite of measurable properties — symmetry, proportions,
              balance, framing, lighting. Not an objective appearance judgment.
            </p>
          )}
          <div className="mt-3 space-y-1.5 text-[10px]">
            {(
              [
                ["SYMMETRY", report.aesthetic.symmetry],
                ["PROPORTION", report.aesthetic.proportion],
                ["BALANCE", report.aesthetic.balance],
                ["FRAMING", report.aesthetic.framing],
                ["LIGHTING", report.aesthetic.lighting],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between">
                <span className="text-neutral-600">{k}</span>
                <span className="flex items-center gap-2">
                  <span className="h-px w-20 bg-neutral-800">
                    <span
                      className="block h-px bg-neutral-400 transition-[width] duration-700"
                      style={{ width: `${v}%` }}
                    />
                  </span>
                  <CountUp value={v} className="w-6 text-right text-neutral-300" />
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* gaze signature */}
        <Section delay={240} className="w-full border-t border-neutral-800 pt-4">
          <Header text="GAZE SIGNATURE" />
          <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
            <Bar w={report.gaze.left} c="#8cd2f0" />
            <Bar w={report.gaze.center} c="#e1e8f0" />
            <Bar w={report.gaze.right} c="#6b8ea3" />
          </div>
          <div className="mt-1 flex justify-between text-[8px] tracking-[0.2em] text-neutral-600">
            <span>LEFT {(report.gaze.left * 100).toFixed(0)}%</span>
            <span>CENTER {(report.gaze.center * 100).toFixed(0)}%</span>
            <span>RIGHT {(report.gaze.right * 100).toFixed(0)}%</span>
          </div>
          <div className="mt-2 text-[10px] text-neutral-400">
            STABILITY — {report.gaze.stabilityLabel}
          </div>
        </Section>

        {/* palette */}
        {report.palette && (
          <Section delay={320} className="w-full border-t border-neutral-800 pt-4">
            <Header text="VISUAL PALETTE" />
            <div className="mt-2 flex items-center gap-2">
              {report.palette.colors.map((c, i) => (
                <span
                  key={c}
                  className="h-6 w-6 rounded-sm border border-neutral-800 animate-[fadeIn_0.5s_ease-out]"
                  style={{ background: c, animationDelay: `${i * 80}ms`, animationFillMode: "backwards" }}
                />
              ))}
              <span className="ml-2 text-[9px] text-neutral-500">
                {report.palette.temperature} · {report.palette.contrastLabel}
              </span>
            </div>
          </Section>
        )}

        {/* aura profile */}
        <Section delay={400} className="w-full border-t border-neutral-800 pt-4">
          <Header text="AURA PROFILE" sub="VISUAL INTERPRETATION" />
          <div className="text-[14px] tracking-[0.3em] text-cyan-200/90">
            {report.aura.join("  /  ")}
          </div>
          <div className="mt-1 text-[8px] tracking-normal text-neutral-600">
            Experimental visual interpretation derived from camera-visible signals.
          </div>
        </Section>

        {/* optimal frame */}
        {report.bestFrame && (
          <Section delay={480} className="w-full border-t border-neutral-800 pt-4">
            <OptimalFrame
              best={report.bestFrame}
              mirrored={frame.current.mirrored}
            />
            <div className="mt-2 text-[8px] tracking-[0.2em] text-neutral-600">
              {report.candidatesEvaluated} CANDIDATES EVALUATED
            </div>
          </Section>
        )}

        {/* camera ⇄ geometry */}
        <Section delay={560} className="w-full border-t border-neutral-800 pt-5">
          <div className="mb-3 text-center text-[9px] tracking-[0.25em] text-neutral-600">
            CAMERA ⇄ GEOMETRY
          </div>
          <div className="flex justify-center">
            <CameraGeometryBlend frame={frame} videoRef={videoRef} size={230} />
          </div>
        </Section>

        <div className="mt-7 w-full border-t border-neutral-800 pt-3 text-center text-[9px] leading-5 tracking-[0.2em] text-neutral-600">
          BROWSER-SIDE INFERENCE · LOCAL ONLY · NO FRAME UPLOAD
        </div>

        <div className="mt-5 flex w-full gap-3 pb-6">
          <button
            onClick={share}
            disabled={sharing}
            className="min-h-11 flex-1 rounded border border-neutral-700 py-2.5 text-[11px] tracking-[0.25em] text-neutral-200 transition-colors hover:border-neutral-500 hover:text-white disabled:opacity-50"
          >
            {sharing ? "…" : "SHARE"}
          </button>
          <button
            onClick={onClose}
            className="min-h-11 flex-1 rounded border border-neutral-700 py-2.5 text-[11px] tracking-[0.25em] text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
          >
            LIVE
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  children,
  delay,
  className = "",
}: {
  children: React.ReactNode;
  delay: number;
  className?: string;
}) {
  return (
    <div
      className={`animate-[fadeIn_0.5s_ease-out] ${className}`}
      style={{ animationDelay: `${delay}ms`, animationFillMode: "backwards" }}
    >
      {children}
    </div>
  );
}

function Header({ text, sub }: { text: string; sub?: string }) {
  return (
    <div className="mb-2">
      <div className="text-[9px] tracking-[0.25em] text-neutral-600">{text}</div>
      {sub && (
        <div className="mt-0.5 text-[8px] tracking-[0.2em] text-neutral-700">
          {sub}
        </div>
      )}
    </div>
  );
}

function Bar({ w, c }: { w: number; c: string }) {
  return (
    <span
      className="block h-full transition-[width] duration-700"
      style={{ width: `${Math.max(0, Math.min(1, w)) * 100}%`, background: c }}
    />
  );
}

function CountUp({
  value,
  className = "",
}: {
  value: number;
  className?: string;
}) {
  const [v, setV] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? value
      : 0,
  );
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min((t - t0) / 700, 1);
      setV(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={`tabular-nums ${className}`}>{v}</span>;
}
