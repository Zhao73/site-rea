import React, { useEffect, useState } from "react";
import { CrestMark } from "./CrestEmblem.jsx";

/**
 * Dramatic deep-plum opening curtain inspired by editorial archway reveals.
 * Auto-lifts smoothly after load (or skips immediately if ?instant=1).
 */
export function PreloaderCurtain({ open, onDismiss }) {
  const [phase, setPhase] = useState("idle"); // idle -> rising -> gone

  useEffect(() => {
    if (!open) {
      setPhase("gone");
      return;
    }
    setPhase("idle");
    const t1 = setTimeout(() => setPhase("rising"), 1400);
    const t2 = setTimeout(() => {
      setPhase("gone");
      onDismiss?.();
    }, 2350);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [open, onDismiss]);

  if (phase === "gone") return null;

  return (
    <div
      className={`fixed inset-0 z-50 bg-[#340c24] text-[#f3f3ec] flex flex-col items-center justify-between px-6 py-10 transition-all duration-1000 ease-[cubic-bezier(0.76,0,0.24,1)] ${
        phase === "rising"
          ? "-translate-y-full opacity-95 pointer-events-none"
          : "translate-y-0 opacity-100"
      }`}
    >
      {/* Subtle outer bevel frame */}
      <div className="pointer-events-none absolute inset-4 border border-[#f3f3ec]/12 rounded-2xl" />

      {/* Ghost calligraphy watermark */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden opacity-[0.045] select-none">
        <span className="font-script text-[28vw] whitespace-nowrap -rotate-12 text-[#f3f3ec]">
          Arashiyama
        </span>
      </div>

      <div className="relative z-10 pt-2">
        <CrestMark className="w-9 h-9" color="#f3f3ec" />
      </div>

      {/* Center composition */}
      <div className="relative z-10 w-full max-w-5xl flex items-center justify-between gap-4 px-2 sm:px-8">
        <span className="hidden md:inline-block font-micro text-[11px] tracking-[0.42em] text-[#f3f3ec]/75">
          KYOTO
        </span>

        <div className="mx-auto text-center">
          <div className="font-display text-6xl sm:text-8xl md:text-[108px] tracking-tight leading-[0.86] text-[#f3f3ec]">
            <div>KAZE</div>
            <div>SANCTUARY</div>
          </div>
          <div className="font-script text-4xl sm:text-6xl text-[#f3f3ec]/95 -mt-3 sm:-mt-5 -rotate-6 inline-block">
            Arashiyama
          </div>
        </div>

        <span className="hidden md:inline-block font-micro text-[11px] tracking-[0.42em] text-[#f3f3ec]/75">
          JAPAN
        </span>
      </div>

      {/* Bottom vertical hairline + tagline */}
      <div className="relative z-10 flex flex-col items-center gap-4 pb-2">
        <div className="w-px h-14 bg-gradient-to-b from-[#f3f3ec] to-[#f3f3ec]/15" />
        <p className="font-micro text-[10px] tracking-[0.26em] text-center text-[#f3f3ec]/80 leading-relaxed">
          KAZE SANCTUARY
          <br />
          A STILLNESS TO RETURN TO.
        </p>
        <button
          type="button"
          onClick={() => {
            setPhase("rising");
            setTimeout(() => {
              setPhase("gone");
              onDismiss?.();
            }, 600);
          }}
          className="mt-1 text-[10px] font-micro tracking-[0.25em] text-[#f3f3ec]/50 hover:text-[#f3f3ec] transition-colors cursor-pointer"
        >
          ENTER →
        </button>
      </div>
    </div>
  );
}
