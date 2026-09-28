"use client";

import type { TrackingFrame } from "@/types/vision";

/**
 * Director Mode HUD — one primary instruction + a compact check row,
 * anchored to safe zones. Never covers the face.
 */
export default function DirectorOverlay({
  snap,
  fun,
  onSkip,
}: {
  snap: TrackingFrame;
  fun: boolean;
  onSkip: () => void;
}) {
  const d = snap.director;
  if (snap.state !== "director" || !d) return null;

  return (
    <>
      {/* primary instruction — top safe zone */}
      <div
        className={`absolute left-1/2 top-3 w-max max-w-[92vw] -translate-x-1/2 rounded bg-black/40 px-4 py-2 text-center font-mono backdrop-blur-[2px] sm:top-4 ${
          fun && d.phase === "ready"
            ? "border border-cyan-300/40 animate-pulse"
            : ""
        }`}
      >
        {d.phase === "init" ? (
          <div className="text-[11px] font-medium tracking-[0.3em] text-neutral-200">
            DIRECTOR MODE
          </div>
        ) : (
          <>
            <div className="text-[8px] font-medium tracking-[0.25em] text-neutral-500">
              {d.phase === "ready" ? "PORTRAIT" : d.composition}
            </div>
            <div className="mt-1 text-[13px] font-medium tracking-[0.2em] text-neutral-100">
              {d.instruction}
            </div>
            {d.exprProgress !== null && (
              <div className="mx-auto mt-1.5 h-px w-24 bg-neutral-800">
                <div
                  className="h-px bg-cyan-300 transition-[width] duration-100"
                  style={{ width: `${d.exprProgress * 100}%` }}
                />
              </div>
            )}
          </>
        )}
        {fun && d.phase !== "init" && (
          <div className="mt-1 text-[8px] tracking-[0.2em] text-cyan-200/70">
            {funCopy(d.instruction, d.phase)}
          </div>
        )}
      </div>

      {/* check row — lower safe zone */}
      <div className="absolute bottom-12 left-1/2 -translate-x-1/2 sm:bottom-14">
        <div className="flex items-center gap-3 rounded bg-black/40 px-3 py-2 font-mono text-[8px] font-medium tracking-[0.18em] backdrop-blur-[2px]">
          {d.checks.map((c) => (
            <span
              key={c.name}
              className={c.done ? "text-cyan-200/90" : "text-neutral-500"}
            >
              {c.name}
              {c.done ? " ✓" : ""}
            </span>
          ))}
        </div>
        {/* ready-hold progress */}
        {d.phase === "ready" && (
          <div className="mx-auto mt-2 h-px w-32 bg-neutral-800">
            <div
              className="h-px bg-cyan-300 transition-[width] duration-100"
              style={{ width: `${d.holdProgress * 100}%` }}
            />
          </div>
        )}
        {/* graceful exit after 12s without full lock */}
        {d.waitSecs >= 12 && (
          <button
            onClick={onSkip}
            className="mx-auto mt-3 block min-h-11 rounded border border-neutral-700 bg-black/60 px-4 font-mono text-[9px] tracking-[0.2em] text-neutral-300 backdrop-blur"
          >
            CONTINUE ANYWAY
          </button>
        )}
      </div>
    </>
  );
}

function funCopy(instruction: string, phase: string): string {
  if (instruction === "PORTRAIT READY") return "THAT'S THE FRAME.";
  if (phase === "ready") return "LOCKING IT IN.";
  if (instruction === "HOLD STILL") return "HOLD IT…";
  if (instruction === "LOOK AT CAMERA") return "EYES HERE.";
  if (instruction === "MOVE CLOSER") return "ALMOST THERE.";
  if (instruction === "MOVE BACK") return "GIVE IT ROOM.";
  if (instruction === "TRY A SUBTLE SMILE") return "IF YOU FEEL LIKE IT.";
  if (instruction === "RELAX YOUR FACE") return "EASY DOES IT.";
  if (instruction === "EXPRESSION — SET") return "LOVE THAT.";
  if (instruction === "EXPRESSION — NATURAL") return "NATURAL WORKS.";
  if (instruction === "ACQUIRING FACE") return "SCANNING…";
  return "WORKING THE ANGLE.";
}
