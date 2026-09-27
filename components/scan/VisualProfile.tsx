"use client";

import type { VisualProfile as Profile } from "@/types/vision";

/**
 * Deep Scan result — a technical visual profile, not an assessment of
 * the person. Qualitative telemetry only.
 */
export default function VisualProfile({
  profile,
  onClose,
}: {
  profile: Profile;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/85 px-6 backdrop-blur-sm animate-[fadeIn_0.6s_ease-out]">
      <div className="w-full max-w-xs font-mono tracking-[0.15em]">
        <div className="mb-1 text-[10px] text-neutral-600">AURAVISION</div>
        <div className="mb-6 text-sm tracking-[0.3em] text-neutral-200">
          VISUAL PROFILE
        </div>

        <div className="space-y-4 text-[11px]">
          <Row title="FACIAL GEOMETRY" value={profile.geometry} />
          <Row
            title="TEMPORAL DYNAMICS"
            value={`${profile.stabilityLabel} — ${profile.stabilityPct}% STABLE`}
          />
          <Row
            title="HEAD POSE"
            value={`REFERENCE ACQUIRED (±${profile.poseSpreadDeg}°)`}
          />
          <Row
            title="GAZE"
            value={`TRACKING CONFIDENCE ${profile.gazeConfidencePct}%`}
          />
          <Row title="ILLUMINATION FIELD" value={profile.lighting} />
          <Row title="TRACKING QUALITY" value={profile.trackingQuality} />
        </div>

        <div className="mt-8 border-t border-neutral-800 pt-4 text-[10px] leading-5 text-neutral-600">
          {profile.landmarkCount} LANDMARKS ·{" "}
          {(profile.durationMs / 1000).toFixed(0)}S SAMPLE · MONOCULAR RGB ·
          BROWSER-SIDE INFERENCE
        </div>

        <button
          onClick={onClose}
          className="mt-6 w-full rounded border border-neutral-700 py-2.5 text-[11px] tracking-[0.25em] text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
        >
          RETURN TO LIVE
        </button>
      </div>
    </div>
  );
}

function Row({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <div className="mb-0.5 text-[9px] text-neutral-600">{title}</div>
      <div className="text-neutral-200">{value}</div>
    </div>
  );
}
