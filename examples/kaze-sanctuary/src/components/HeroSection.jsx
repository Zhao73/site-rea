import React, { useState } from "react";
import { ArrowDown, Sparkles } from "lucide-react";
import { HERO_HOTSPOTS } from "../data/sanctuaryData.js";

export function HeroSection({ ambiance, onOpenBooking, onScrollTo }) {
  const [activeSpot, setActiveSpot] = useState(null);

  return (
    <section
      id="hero"
      className="relative min-h-screen w-full overflow-hidden bg-[#17233b] text-white flex flex-col justify-between"
    >
      {/* Crossfading Daylight & Twilight architectural photography */}
      <div className="absolute inset-0">
        <img
          src="./images/hero-day.webp"
          alt="KAZE Sanctuary limestone and cedar pavilion in Arashiyama daylight"
          className={`absolute inset-0 w-full h-full object-cover object-center transition-all duration-1000 ease-out scale-[1.02] ${
            ambiance === "day" ? "opacity-100" : "opacity-0"
          }`}
        />
        <img
          src="./images/hero-night.webp"
          alt="KAZE Sanctuary pavilion glowing at twilight beside turquoise thermal pool"
          className={`absolute inset-0 w-full h-full object-cover object-center transition-all duration-1000 ease-out scale-[1.02] ${
            ambiance === "night" ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          className={`absolute inset-0 transition-colors duration-1000 ${
            ambiance === "day"
              ? "bg-gradient-to-b from-[#17233b]/55 via-[#17233b]/20 to-[#340c24]/70"
              : "bg-gradient-to-b from-[#17233b]/50 via-[#17233b]/25 to-[#340c24]/80"
          }`}
        />
      </div>

      {/* Interactive architectural pin hotspots (desktop) */}
      <div className="hidden lg:block absolute inset-0 z-20 pointer-events-none">
        {HERO_HOTSPOTS.map((spot) => {
          const isOpen = activeSpot === spot.id;
          return (
            <div
              key={spot.id}
              style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
              className="absolute pointer-events-auto -translate-x-1/2 -translate-y-1/2"
            >
              <button
                type="button"
                onClick={() => setActiveSpot(isOpen ? null : spot.id)}
                aria-label={spot.label}
                className="group relative flex items-center justify-center w-8 h-8 rounded-full bg-white/20 backdrop-blur-md border border-white/60 hover:bg-white hover:text-[#17233b] transition-all cursor-pointer"
              >
                <span className="w-2 h-2 rounded-full bg-current" />
                <span className="absolute inset-0 rounded-full border border-white/50 animate-ping opacity-40" />
              </button>

              {isOpen && (
                <div className="absolute left-10 top-1/2 -translate-y-1/2 w-64 rounded-xl bg-[#f3f3ec]/95 backdrop-blur-md text-[#17233b] p-4 shadow-2xl border border-[#17233b]/10 z-30">
                  <div className="flex items-center gap-1.5 text-[10px] font-micro text-[#340c24] mb-1">
                    <Sparkles className="w-3 h-3" />
                    <span>ARCHITECTURAL DETAIL</span>
                  </div>
                  <h4 className="font-display text-2xl leading-tight mb-1.5">
                    {spot.label}
                  </h4>
                  <p className="text-xs leading-relaxed text-[#17233b]/80">
                    {spot.detail}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Top spacer for fixed navbar */}
      <div className="h-24" />

      {/* Center monumental editorial display */}
      <div className="relative z-10 flex flex-col items-center text-center px-6 my-auto py-8">
        <div className="flex items-center gap-6 sm:gap-12 mb-4">
          <span className="hidden sm:inline-block font-micro text-[10px] tracking-[0.42em] text-white/80">
            ARASHIYAMA
          </span>
          <span className="font-micro text-[10px] tracking-[0.34em] text-white/90">
            {ambiance === "day"
              ? "A SANCTUARY BY DAY"
              : "A LANTERN RETREAT BY NIGHT"}
          </span>
          <span className="hidden sm:inline-block font-micro text-[10px] tracking-[0.42em] text-white/80">
            KYOTO
          </span>
        </div>

        <h1 className="font-display text-[17vw] sm:text-[13vw] lg:text-[138px] leading-[0.84] tracking-[-0.025em] text-white drop-shadow-[0_12px_36px_rgba(23,35,59,0.45)]">
          <span className="block">KAZE</span>
          <span className="block">SANCTUARY</span>
        </h1>

        <p className="font-script text-5xl sm:text-7xl text-[#f3f3ec] -mt-4 sm:-mt-7 -rotate-6 drop-shadow-[0_6px_20px_rgba(23,35,59,0.5)]">
          Arashiyama
        </p>

        {/* Centered arched portal button */}
        <div className="mt-8 sm:mt-10 flex flex-wrap items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => onScrollTo("#pavilions")}
            className="arch-top border border-white/55 bg-[#340c24]/45 hover:bg-[#f3f3ec] hover:text-[#340c24] backdrop-blur-md px-8 pt-7 pb-5 font-micro text-[10px] tracking-[0.26em] transition-all duration-500 cursor-pointer"
          >
            VIEW AVAILABLE
            <br />
            PAVILIONS
          </button>
          <button
            type="button"
            onClick={() => onOpenBooking()}
            className="rounded-full border border-white/40 bg-white/10 hover:bg-white hover:text-[#17233b] backdrop-blur-md px-6 py-3.5 font-micro text-[10px] tracking-[0.24em] transition-all duration-300 cursor-pointer"
          >
            PRIVATE INQUIRY
          </button>
        </div>
      </div>

      {/* Bottom scroll indicator bar */}
      <div className="relative z-10 px-6 sm:px-10 pb-8 flex items-end justify-between text-[10px] font-micro text-white/80">
        <span className="hidden sm:inline-block tracking-[0.24em]">
          18 CONTEMPORARY PAVILIONS · 35°00&apos;N 135°40&apos;E
        </span>
        <button
          type="button"
          onClick={() => onScrollTo("#pillars")}
          className="mx-auto sm:mx-0 inline-flex items-center gap-2 tracking-[0.28em] hover:text-white transition-colors cursor-pointer"
        >
          <span>SCROLL TO DISCOVER</span>
          <ArrowDown className="w-3.5 h-3.5 animate-bounce" />
        </button>
      </div>
    </section>
  );
}
