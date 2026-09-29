"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { regionDetail, summarizeTimeline } from "@/lib/lab/timeline";
import type { TimelineSample } from "@/types/vision";

/**
 * Expression timeline — instrument-style readout of the recorded Free
 * Lab session: six regional activity waveforms, event markers, a
 * scrubbable playhead, and a factual summary. Derived numeric motion
 * data only — no camera frames, no emotion claims.
 */

const ACCENT = "140, 210, 240";
const WHITE = "225, 232, 240";

const TRACKS = [
  ["BROW", "brow"],
  ["EYES", "eyes"],
  ["NOSE", "nose"],
  ["MOUTH", "mouth"],
  ["CHEEKS", "cheeks"],
  ["JAW", "jaw"],
] as const;

const LABEL_W = 44;
const TRACK_H = 26;
const PAD = 8;

interface Props {
  samples: TimelineSample[];
  fun: boolean;
  onBack: () => void;
  onSignature: () => void;
  onLive: () => void;
}

export default function MotionTimeline({
  samples,
  fun,
  onBack,
  onSignature,
  onLive,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playT, setPlayT] = useState(0); // 0..1 position
  const [playing, setPlaying] = useState(false);
  const [region, setRegion] = useState<string | null>(null);
  const playRef = useRef(playT);
  const playingRef = useRef(false);
  useEffect(() => {
    playRef.current = playT;
    playingRef.current = playing;
  }, [playT, playing]);

  const summary = useMemo(() => summarizeTimeline(samples), [samples]);
  const detail = useMemo(
    () =>
      region
        ? regionDetail(
            samples,
            region.toLowerCase() as keyof TimelineSample["regions"],
          )
        : null,
    [samples, region],
  );

  // canvas timeline — always-rendered (cheap), playhead driven by state
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const render = () => {
      raf = requestAnimationFrame(render);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = canvas.clientWidth;
      const H = PAD * 2 + TRACKS.length * TRACK_H;
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (samples.length < 2) return;

      // playback advance
      if (playingRef.current) {
        const next = playRef.current + 0.016 / (summary.durationMs / 1000);
        if (next >= 1) {
          playingRef.current = false;
          setPlaying(false);
          setPlayT(1);
        } else {
          setPlayT(next);
        }
      }

      const t0 = samples[0].t;
      const t1 = samples[samples.length - 1].t;
      const span = Math.max(1, t1 - t0);
      const xOf = (t: number) => LABEL_W + ((t - t0) / span) * (W - LABEL_W - PAD);
      const playX = xOf(t0 + playRef.current * span);

      // playhead position → per-sample region highlight
      const curIdx = Math.min(
        samples.length - 1,
        Math.floor(playRef.current * (samples.length - 1)),
      );
      const cur = samples[curIdx];

      TRACKS.forEach(([label, key], i) => {
        const y = PAD + i * TRACK_H;
        const mid = y + TRACK_H / 2;
        const sel = region === label;

        // track label
        ctx.font = "8px ui-monospace, monospace";
        ctx.textAlign = "left";
        ctx.fillStyle = `rgba(${WHITE}, ${sel ? 0.9 : 0.5})`;
        ctx.fillText(label, PAD, mid + 3);

        // baseline
        ctx.strokeStyle = `rgba(${WHITE}, 0.08)`;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(LABEL_W, mid);
        ctx.lineTo(W - PAD, mid);
        ctx.stroke();

        // waveform
        ctx.strokeStyle = `rgba(${ACCENT}, ${sel ? 0.9 : 0.55})`;
        ctx.lineWidth = sel ? 1.4 : 1;
        ctx.beginPath();
        for (let i2 = 0; i2 < samples.length; i2++) {
          const s = samples[i2];
          const xx = xOf(s.t);
          const yy = mid - s.regions[key] * (TRACK_H / 2 - 2);
          if (i2 === 0) ctx.moveTo(xx, yy);
          else ctx.lineTo(xx, yy);
        }
        ctx.stroke();

        // filled activity under curve
        ctx.fillStyle = `rgba(${ACCENT}, 0.07)`;
        ctx.beginPath();
        ctx.moveTo(LABEL_W, mid);
        for (let i2 = 0; i2 < samples.length; i2++) {
          const s = samples[i2];
          ctx.lineTo(xOf(s.t), mid - s.regions[key] * (TRACK_H / 2 - 2));
        }
        ctx.lineTo(W - PAD, mid);
        ctx.closePath();
        ctx.fill();

        // event markers on this track
        ctx.fillStyle = `rgba(${ACCENT}, 0.8)`;
        for (const s of samples) {
          if (!s.events.length) continue;
          const xx = xOf(s.t);
          ctx.fillRect(xx - 0.5, y + 2, 1, 3);
        }

        // current-value tick at playhead
        const cv = cur.regions[key];
        const cy = mid - cv * (TRACK_H / 2 - 2);
        ctx.fillStyle = `rgba(${WHITE}, ${sel ? 0.9 : 0.6})`;
        ctx.beginPath();
        ctx.arc(playX, cy, 2, 0, Math.PI * 2);
        ctx.fill();
      });

      // playhead
      ctx.strokeStyle = `rgba(${WHITE}, 0.5)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(playX, PAD - 2);
      ctx.lineTo(playX, H - PAD + 2);
      ctx.stroke();
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [samples, region, summary.durationMs]);

  const scrub = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const frac = (x - LABEL_W) / Math.max(1, rect.width - LABEL_W - PAD);
    setPlayT(Math.max(0, Math.min(1, frac)));
  };

  const secs = (ms: number) => (ms / 1000).toFixed(1);

  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-[#0b0d0e] animate-[fadeIn_0.6s_ease-out]">
      <div className="mx-auto flex min-h-full w-full max-w-sm flex-col items-center px-6 py-6 font-mono tracking-[0.15em]">
        <div className="text-[9px] tracking-[0.3em] text-neutral-500">
          EXPRESSION LAB
        </div>
        <h1 className="mt-2 text-xl font-medium tracking-[0.2em] text-neutral-100">
          FACIAL MOTION TIMELINE
        </h1>
        <div className="mt-1 text-[9px] tracking-[0.25em] text-cyan-200/80">
          TEMPORAL RESPONSE · LOCAL ANALYSIS
        </div>

        {!summary.sufficient ? (
          <div className="mt-10 w-full max-w-[300px] rounded border border-white/10 px-4 py-6 text-center">
            <div className="text-[10px] tracking-[0.25em] text-neutral-300">
              INSUFFICIENT MOTION
            </div>
            <div className="mt-2 text-[8px] leading-relaxed tracking-[0.15em] text-neutral-500">
              NOT ENOUGH TEMPORAL DATA — TRY MOVING YOUR FACE NATURALLY FOR
              A FEW SECONDS.
            </div>
          </div>
        ) : (
          <>
            <canvas
              ref={canvasRef}
              className="mt-5 w-full cursor-crosshair rounded border border-white/10"
              style={{ height: PAD * 2 + TRACKS.length * TRACK_H }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                scrub(e);
                const rect = e.currentTarget.getBoundingClientRect();
                const row = Math.floor((e.clientY - rect.top - PAD) / TRACK_H);
                if (row >= 0 && row < TRACKS.length)
                  setRegion(
                    region === TRACKS[row][0] ? null : TRACKS[row][0],
                  );
                else scrub(e);
              }}
              onPointerMove={(e) => {
                if (e.buttons) scrub(e);
              }}
            />

            {/* summary */}
            <div className="mt-4 grid w-full max-w-[300px] grid-cols-4 gap-2 text-center">
              {(
                [
                  ["DURATION", `${secs(summary.durationMs)}s`],
                  ["ACTIVE", `${secs(summary.activeMs)}s`],
                  ["PEAK", summary.peakRegion],
                  ["EVENTS", String(summary.eventCount)],
                ] as const
              ).map(([k, v]) => (
                <div
                  key={k}
                  className="rounded border border-white/10 px-1 py-2"
                >
                  <div className="text-[7px] tracking-[0.2em] text-neutral-500">
                    {k}
                  </div>
                  <div className="mt-1 text-[10px] text-neutral-200">{v}</div>
                </div>
              ))}
            </div>

            {/* region detail */}
            {detail && region && (
              <div className="mt-3 w-full max-w-[300px] rounded border border-white/10 px-4 py-3">
                <div className="text-[9px] tracking-[0.25em] text-cyan-200/80">
                  {region}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  {(
                    [
                      ["PEAK", `${Math.round(detail.peak * 100)}%`],
                      ["ACTIVE", `${secs(detail.activeMs)}s`],
                      ["EVENTS", String(detail.events)],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k}>
                      <div className="text-[7px] tracking-[0.2em] text-neutral-500">
                        {k}
                      </div>
                      <div className="mt-0.5 text-[10px] text-neutral-200">
                        {v}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-[7px] tracking-[0.2em] text-neutral-600">
                  GEOMETRIC MOTION · MEASURED FROM BASELINE DISPLACEMENT
                </div>
              </div>
            )}

            {/* transport */}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setPlaying((p) => !p)}
                className="rounded border border-white/20 px-4 py-2 text-[9px] tracking-[0.25em] text-neutral-300 transition hover:border-cyan-300/50 hover:text-cyan-200"
              >
                {playing ? "PAUSE" : "PLAY"}
              </button>
              <button
                onClick={() => {
                  setPlayT(0);
                  setPlaying(true);
                }}
                className="rounded border border-white/20 px-4 py-2 text-[9px] tracking-[0.25em] text-neutral-300 transition hover:border-cyan-300/50 hover:text-cyan-200"
              >
                REPLAY
              </button>
            </div>
          </>
        )}

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            onClick={onBack}
            className="rounded border border-white/20 px-4 py-2 text-[9px] tracking-[0.25em] text-neutral-300 transition hover:border-cyan-300/50 hover:text-cyan-200"
          >
            BACK TO FREE LAB
          </button>
          {summary.sufficient && (
            <button
              onClick={onSignature}
              className="rounded border border-cyan-300/40 bg-cyan-300/10 px-4 py-2 text-[9px] tracking-[0.25em] text-cyan-200 transition hover:bg-cyan-300/20"
            >
              CREATE MOTION SIGNATURE
            </button>
          )}
          <button
            onClick={onLive}
            className="rounded border border-white/15 px-4 py-2 text-[9px] tracking-[0.25em] text-neutral-400 transition hover:text-neutral-200"
          >
            EXIT
          </button>
        </div>
        {fun && (
          <div className="mt-3 text-[8px] tracking-[0.3em] text-cyan-300/60 animate-pulse">
            TEMPORAL SIGNAL LOGGED
          </div>
        )}
      </div>
    </div>
  );
}
