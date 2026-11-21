import React from "react";
import { ArrowUp, ArrowUpRight, RotateCcw } from "lucide-react";
import { CrestMark } from "./CrestEmblem.jsx";

export function FooterSection({ onScrollTo, onOpenBooking, onReplayCurtain }) {
  return (
    <footer className="relative bg-[#340c24] text-[#f3f3ec] px-6 sm:px-12 pt-24 pb-12 overflow-hidden">
      {/* Subtle calligraphy ghost background */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.04] select-none overflow-hidden">
        <span className="font-script text-[24vw] whitespace-nowrap -rotate-6">
          Kaze Sanctuary
        </span>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto">
        {/* Top CTA band */}
        <div className="border-b border-[#f3f3ec]/15 pb-16 flex flex-col lg:flex-row lg:items-end justify-between gap-10">
          <div className="max-w-2xl">
            <p className="font-micro text-[10px] tracking-[0.28em] text-[#b5cedb] mb-4">
              PRIVATE CONSULTATION · BY APPOINTMENT
            </p>
            <h2 className="font-display text-5xl sm:text-7xl leading-[0.9] uppercase">
              A SHORT CONVERSATION IS ENOUGH TO FIND THE PAVILION THAT FITS YOUR
              RHYTHM OF LIFE.
            </h2>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => onOpenBooking()}
              className="inline-flex items-center gap-2 rounded-full bg-[#f3f3ec] text-[#340c24] px-7 py-4 font-micro text-[10px] font-semibold tracking-[0.22em] hover:bg-[#b5cedb] transition-colors cursor-pointer"
            >
              <span>SCHEDULE PRIVATE VIEWING</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onReplayCurtain}
              className="inline-flex items-center gap-2 rounded-full border border-[#f3f3ec]/30 px-5 py-4 font-micro text-[10px] tracking-[0.22em] hover:bg-[#f3f3ec]/10 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>REPLAY INTRO</span>
            </button>
          </div>
        </div>

        {/* Middle gallery office & metadata */}
        <div className="py-14 grid grid-cols-1 md:grid-cols-12 gap-10 items-start">
          <div className="md:col-span-4 space-y-4">
            <div className="flex items-center gap-3">
              <CrestMark className="w-8 h-8" color="#f3f3ec" />
              <span className="font-display text-2xl tracking-wide">
                KAZE SANCTUARY
              </span>
            </div>
            <p className="text-xs leading-relaxed text-[#f3f3ec]/70 max-w-xs">
              18 contemporary cedar and limestone pavilions in Arashiyama,
              Kyoto. Designed around stillness, thermal bathing, and four-season
              gardens.
            </p>
          </div>

          <div className="md:col-span-4 space-y-2">
            <p className="font-micro text-[10px] tracking-[0.26em] text-[#b5cedb]">
              PRIVATE GALLERY OFFICE
            </p>
            <p className="text-sm text-[#f3f3ec]/90">
              14 Sagatenryuji Susukinobabacho
              <br />
              Ukyo Ward, Kyoto 616-8385, Japan
            </p>
            <p className="text-sm text-[#f3f3ec]/80 pt-1">+81 (75) 555-0194</p>
            <p className="text-sm text-[#f3f3ec]/80">atelier@kaze-sanctuary.example</p>
          </div>

          <div className="md:col-span-4 flex flex-col md:items-end justify-between gap-6">
            <button
              type="button"
              onClick={() => onScrollTo("#hero")}
              className="inline-flex items-center gap-2 rounded-full border border-[#f3f3ec]/30 px-5 py-2.5 font-micro text-[10px] tracking-[0.24em] hover:bg-[#f3f3ec] hover:text-[#340c24] transition-colors cursor-pointer"
            >
              <span>TO TOP</span>
              <ArrowUp className="w-3.5 h-3.5" />
            </button>

            <div className="text-left md:text-right text-[11px] text-[#f3f3ec]/55 leading-relaxed max-w-xs">
              100% original React, Tailwind, GSAP &amp; Lenis codebase created
              as a{" "}
              <span className="text-[#b5cedb]">Site-REA</span> creative
              secondary-development showcase. All copy, SVG emblems, and imagery
              are newly authored.
            </div>
          </div>
        </div>

        {/* Bottom hairline bar */}
        <div className="border-t border-[#f3f3ec]/12 pt-6 flex flex-wrap items-center justify-between gap-4 font-micro text-[9px] tracking-[0.24em] text-[#f3f3ec]/45">
          <span>© 2026 KAZE SANCTUARY · FICTIONAL ARCHITECTURAL SHOWCASE</span>
          <span>ARASHIYAMA · KYOTO · JAPAN</span>
        </div>
      </div>
    </footer>
  );
}
