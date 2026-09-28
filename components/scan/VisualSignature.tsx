"use client";

import SignatureMesh from "@/components/visualization/SignatureMesh";
import type { VisualProfile } from "@/types/vision";

/**
 * Visual Signature — the Deep Scan artifact. A rotating geometric
 * representation of the merged multi-view face, surrounded by a few
 * qualitative attributes. Designed to be screenshot-worthy.
 */
export default function VisualSignature({
  profile,
  onClose,
}: {
  profile: VisualProfile;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#0b0d0e]/95 px-6 animate-[fadeIn_0.6s_ease-out]">
      <div className="flex w-full max-w-xs flex-col items-center font-mono tracking-[0.15em]">
        <div className="text-[10px] tracking-[0.3em] text-neutral-600">
          AURAVISION
        </div>
        <div className="mt-4 text-sm tracking-[0.35em] text-neutral-100">
          VISUAL SIGNATURE
        </div>
        <div className="mt-1 text-[9px] tracking-[0.25em] text-neutral-600">
          MONOCULAR FACIAL RECONSTRUCTION
        </div>

        {/* hero geometry */}
        <div className="my-6">
          <SignatureMesh
            points={profile.signaturePoints}
            size={240}
          />
        </div>

        <div className="grid w-full grid-cols-2 gap-x-6 gap-y-4 text-[10px]">
          <Attr title="GEOMETRY" value={profile.geometry} />
          <Attr
            title="TEMPORAL STABILITY"
            value={`${profile.stabilityLabel}`}
          />
          <Attr
            title="HEAD POSE"
            value={profile.poseSpreadDeg < 8 ? "STABLE" : "VARIABLE"}
          />
          <Attr
            title="GAZE"
            value={profile.gazeConfidencePct > 55 ? "HIGH CONFIDENCE" : "LOW CONFIDENCE"}
          />
          <Attr
            title="DEPTH FIELD"
            value={profile.viewsCaptured > 0 ? "ACQUIRED" : "PARTIAL"}
          />
          <Attr title="TRACKING" value={profile.trackingQuality} />
        </div>

        <div className="mt-7 w-full border-t border-neutral-800 pt-3 text-center text-[9px] leading-5 tracking-[0.2em] text-neutral-600">
          {profile.signaturePointCount} POINTS · {profile.viewsCaptured} VIEWS
          <br />
          MONOCULAR RGB — BROWSER-SIDE INFERENCE
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
