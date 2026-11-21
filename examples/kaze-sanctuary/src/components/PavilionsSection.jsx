import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Check, X, ArrowUpRight } from "lucide-react";
import { PAVILIONS } from "../data/sanctuaryData.js";

/**
 * Interactive 3-typology pavilion showcase faithfully inspired by the asymmetric
 * editorial spec layout — enhanced with real switching & floorplan detail sheet.
 */
export function PavilionsSection({ onSelectForBooking }) {
  const [index, setIndex] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const current = PAVILIONS[index];

  const prev = () => setIndex((i) => (i - 1 + PAVILIONS.length) % PAVILIONS.length);
  const next = () => setIndex((i) => (i + 1) % PAVILIONS.length);

  return (
    <section
      id="pavilions"
      className="relative bg-[#b5cedb] text-[#17233b] py-20 sm:py-28 px-6 overflow-hidden"
    >
      <div className="max-w-6xl mx-auto">
        {/* Top 3-column editorial stage */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-6 items-center">
          {/* Left specs */}
          <div className="lg:col-span-3 space-y-8 order-2 lg:order-1">
            <div>
              <p className="font-micro text-[10px] tracking-[0.24em] text-[#17233b]/65">
                BEDROOMS
              </p>
              <p className="font-display text-4xl sm:text-5xl mt-1">
                {current.bedrooms}
              </p>
            </div>
            <div>
              <p className="font-micro text-[10px] tracking-[0.24em] text-[#17233b]/65">
                INTERIOR AREA UP TO
              </p>
              <p className="font-display text-3xl sm:text-4xl mt-1">
                {current.area}
              </p>
            </div>
            <div className="hidden lg:block pt-2 border-t border-[#17233b]/15">
              <p className="font-micro text-[9px] tracking-[0.24em] text-[#17233b]/60">
                ORIENTATION
              </p>
              <p className="text-xs font-medium mt-1">{current.orientation}</p>
            </div>
          </div>

          {/* Center vertical architectural frame */}
          <div className="lg:col-span-6 order-1 lg:order-2 flex justify-center">
            <div className="relative w-full max-w-[430px] aspect-[3/4] overflow-hidden shadow-[0_28px_70px_rgba(23,35,59,0.22)]">
              <img
                key={current.id}
                src={current.image}
                alt={`${current.titleLine1} ${current.titleLine2}`}
                className="w-full h-full object-cover transition-all duration-700"
              />
            </div>
          </div>

          {/* Right description + pill CTA */}
          <div className="lg:col-span-3 order-3 space-y-6">
            <p className="text-sm leading-relaxed text-[#17233b]/85">
              {current.summary}
            </p>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="inline-flex items-center gap-2 rounded-full border border-[#17233b] px-6 py-3 font-micro text-[10px] font-semibold tracking-[0.2em] hover:bg-[#17233b] hover:text-[#f3f3ec] transition-colors cursor-pointer"
            >
              <span>{current.cta}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Monumental overlapping display title */}
        <div className="relative z-10 -mt-10 sm:-mt-20 text-center pointer-events-none select-none">
          <h2 className="font-display text-5xl sm:text-7xl lg:text-[112px] leading-[0.86] uppercase text-[#17233b]">
            <span className="block">{current.titleLine1}</span>
            <span className="block">{current.titleLine2}</span>
          </h2>
        </div>

        {/* Interactive slider controls (< 01 ——— 03 >) */}
        <div className="mt-10 flex items-center justify-center gap-5">
          <button
            type="button"
            onClick={prev}
            aria-label="Previous pavilion typology"
            className="w-10 h-10 rounded-full border border-[#17233b]/30 flex items-center justify-center hover:bg-[#17233b] hover:text-[#f3f3ec] transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <span className="font-micro text-[11px] font-semibold">
            {current.indexLabel}
          </span>

          <div className="w-28 sm:w-44 h-[2px] bg-[#17233b]/20 relative overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-[#17233b] transition-all duration-500"
              style={{ width: `${((index + 1) / PAVILIONS.length) * 100}%` }}
            />
          </div>

          <span className="font-micro text-[11px] text-[#17233b]/60">
            0{PAVILIONS.length}
          </span>

          <button
            type="button"
            onClick={next}
            aria-label="Next pavilion typology"
            className="w-10 h-10 rounded-full border border-[#17233b]/30 flex items-center justify-center hover:bg-[#17233b] hover:text-[#f3f3ec] transition-colors cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Typology quick pills */}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {PAVILIONS.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setIndex(i)}
              className={`px-3.5 py-1.5 rounded-full text-[10px] font-micro tracking-[0.2em] transition-colors cursor-pointer ${
                i === index
                  ? "bg-[#17233b] text-[#f3f3ec]"
                  : "bg-[#17233b]/8 text-[#17233b]/75 hover:bg-[#17233b]/15"
              }`}
            >
              {p.indexLabel} · {p.titleLine2}
            </button>
          ))}
        </div>
      </div>

      {/* Floorplan & Specification Slide-Over Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 bg-[#17233b]/60 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-lg bg-[#f3f3ec] text-[#17233b] h-full overflow-y-auto p-7 sm:p-10 flex flex-col justify-between shadow-2xl">
            <div>
              <div className="flex items-center justify-between border-b border-[#17233b]/15 pb-5">
                <span className="font-micro text-[10px] tracking-[0.26em] text-[#340c24]">
                  PAVILION DOSSIER · {current.indexLabel} / 0{PAVILIONS.length}
                </span>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close pavilion dossier"
                  className="p-2 rounded-full hover:bg-[#17233b]/10 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <h3 className="font-display text-5xl leading-[0.9] mt-6">
                {current.titleLine1} {current.titleLine2}
              </h3>

              <div className="mt-6 overflow-hidden rounded-lg aspect-[16/10]">
                <img
                  src={current.image}
                  alt={current.titleLine1}
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="mt-6 grid grid-cols-3 gap-4 border-y border-[#17233b]/15 py-4 text-left">
                <div>
                  <p className="font-micro text-[9px] text-[#17233b]/55">BEDROOMS</p>
                  <p className="font-display text-2xl mt-0.5">{current.bedrooms}</p>
                </div>
                <div>
                  <p className="font-micro text-[9px] text-[#17233b]/55">AREA</p>
                  <p className="font-display text-2xl mt-0.5">{current.area}</p>
                </div>
                <div>
                  <p className="font-micro text-[9px] text-[#17233b]/55">OUTDOOR</p>
                  <p className="text-xs font-medium mt-1">{current.terraceArea}</p>
                </div>
              </div>

              <p className="mt-6 text-sm leading-relaxed text-[#17233b]/80">
                {current.summary}
              </p>

              <ul className="mt-6 space-y-3">
                {current.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2.5 text-sm">
                    <Check className="w-4 h-4 text-[#340c24] shrink-0 mt-0.5" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pt-8 mt-8 border-t border-[#17233b]/15">
              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(false);
                  onSelectForBooking(`${current.titleLine1} ${current.titleLine2}`);
                }}
                className="w-full rounded-full bg-[#340c24] text-[#f3f3ec] py-4 font-micro text-[11px] tracking-[0.22em] hover:bg-[#17233b] transition-colors cursor-pointer"
              >
                REQUEST FLOORPLAN &amp; PRIVATE VIEWING
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
