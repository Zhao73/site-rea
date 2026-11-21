import React, { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { INTERIOR_GALLERY, OPTIONAL_UPGRADES } from "../data/sanctuaryData.js";
import { BlossomCorner } from "./BlossomLayer.jsx";

export function InteriorsSection({ onScrollTo }) {
  const [slide, setSlide] = useState(0);
  const current = INTERIOR_GALLERY[slide];

  const prev = () =>
    setSlide((s) => (s - 1 + INTERIOR_GALLERY.length) % INTERIOR_GALLERY.length);
  const next = () => setSlide((s) => (s + 1) % INTERIOR_GALLERY.length);

  return (
    <section
      id="interiors"
      className="relative bg-[#f3f3ec] text-[#17233b] py-24 sm:py-36 px-6 overflow-hidden"
    >
      <div className="max-w-7xl mx-auto">
        {/* Monumental tilted calligraphy composition */}
        <div className="reveal-up text-center mb-20 sm:mb-28">
          <h2 className="font-display text-6xl sm:text-8xl lg:text-[132px] leading-[0.84] uppercase">
            <span className="block">THE</span>
            <span className="block">SPACE</span>
            <span className="block">TO</span>
          </h2>
          <p className="font-script text-7xl sm:text-9xl lg:text-[148px] text-[#340c24] -mt-6 sm:-mt-10 -rotate-6 inline-block">
            Breathe in
          </p>
        </div>

        {/* Asymmetric editorial grid: plum-framed garden card + sunlit terrace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-10 items-start">
          {/* Left: deep plum framed card with overhanging blossom */}
          <div className="lg:col-span-5 space-y-6">
            <div className="relative bg-[#340c24] p-8 sm:p-12 overflow-hidden">
              <BlossomCorner position="top-right" className="w-56 sm:w-72" />
              <div className="relative z-10 overflow-hidden aspect-[4/5]">
                <img
                  src="./images/courtyard-onsen.webp"
                  alt="Private sunken limestone courtyard with Japanese maple"
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            <div className="pl-2 space-y-2">
              <p className="font-micro text-[10px] tracking-[0.24em] font-semibold">
                BESPOKE UPGRADES AVAILABLE:
              </p>
              <ul className="space-y-1 text-[11px] font-micro tracking-[0.18em] text-[#17233b]/75">
                {OPTIONAL_UPGRADES.map((u) => (
                  <li key={u}>• {u}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Right: sunlit terrace + craft copy + circular CTA */}
          <div className="lg:col-span-6 lg:col-start-7 space-y-10">
            <div className="overflow-hidden shadow-[0_24px_55px_rgba(23,35,59,0.12)]">
              <img
                src="./images/terrace-sunlight.webp"
                alt="Sun-drenched limestone veranda with dappled maple shadows"
                loading="lazy"
                className="w-full h-72 sm:h-[420px] object-cover parallax-img"
              />
            </div>

            <h3 className="reveal-up font-display text-3xl sm:text-5xl leading-[0.98] uppercase max-w-xl">
              EVERY MATERIAL WAS SELECTED TO CREATE SPACES THAT FEEL QUIET,
              TACTILE AND EFFORTLESS TO LIVE IN
            </h3>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-8 pt-2">
              <p className="text-xs sm:text-sm leading-relaxed text-[#17233b]/75 max-w-xs">
                Hydronic radiant flooring beneath pale oak planks. Concealed
                silent climate engineering. Hand-finished Japanese lime plaster
                and brushed bronze hardware crafted by Kyoto artisans.
              </p>

              <button
                type="button"
                onClick={() => onScrollTo("#pavilions")}
                className="w-36 h-36 rounded-full border border-[#17233b]/45 hover:bg-[#340c24] hover:text-[#f3f3ec] hover:border-[#340c24] flex items-center justify-center text-center px-5 font-micro text-[10px] tracking-[0.2em] transition-all duration-400 cursor-pointer shrink-0"
              >
                VIEW AVAILABLE
                <br />
                PAVILIONS
              </button>
            </div>
          </div>
        </div>

        {/* Interactive wide interior gallery */}
        <div className="mt-24 sm:mt-32">
          <div className="relative overflow-hidden shadow-[0_30px_80px_rgba(23,35,59,0.16)] aspect-[16/9]">
            <img
              key={current.id}
              src={current.image}
              alt={current.title}
              className="w-full h-full object-cover transition-all duration-700"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#17233b]/80 via-[#17233b]/25 to-transparent p-6 sm:p-10 text-white">
              <p className="font-micro text-[10px] tracking-[0.26em] text-[#b5cedb]">
                INTERIOR STUDY · 0{slide + 1} / 0{INTERIOR_GALLERY.length}
              </p>
              <h4 className="font-display text-3xl sm:text-5xl mt-1">
                {current.title}
              </h4>
              <p className="text-xs sm:text-sm text-white/80 max-w-lg mt-1.5">
                {current.caption}
              </p>
            </div>
          </div>

          {/* Gallery navigation controls */}
          <div className="mt-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={prev}
                aria-label="Previous interior photo"
                className="w-9 h-9 rounded-full border border-[#17233b]/30 flex items-center justify-center hover:bg-[#17233b] hover:text-[#f3f3ec] transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-micro text-[10px] font-semibold">
                0{slide + 1}
              </span>
              <div className="w-24 h-px bg-[#17233b]/25 relative">
                <div
                  className="absolute inset-y-0 left-0 bg-[#17233b] transition-all duration-400"
                  style={{
                    width: `${((slide + 1) / INTERIOR_GALLERY.length) * 100}%`,
                  }}
                />
              </div>
              <span className="font-micro text-[10px] text-[#17233b]/55">
                0{INTERIOR_GALLERY.length}
              </span>
              <button
                type="button"
                onClick={next}
                aria-label="Next interior photo"
                className="w-9 h-9 rounded-full border border-[#17233b]/30 flex items-center justify-center hover:bg-[#17233b] hover:text-[#f3f3ec] transition-colors cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <span className="hidden sm:inline-block font-micro text-[10px] tracking-[0.22em] text-[#17233b]/55">
              CLICK ARROWS TO EXPLORE SPACES
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
