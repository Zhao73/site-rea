import React, { useState } from "react";
import { AMENITIES } from "../data/sanctuaryData.js";

/**
 * Full-bleed twilight thermal pool showcase with interactive clickable
 * amenity switcher and circular floating CTA.
 */
export function AmenitiesSection({ onOpenBooking }) {
  const [activeId, setActiveId] = useState(AMENITIES[0].id);
  const current = AMENITIES.find((a) => a.id === activeId) || AMENITIES[0];

  return (
    <section
      id="amenities"
      className="relative min-h-[92vh] w-full overflow-hidden bg-[#17233b] text-white flex flex-col justify-between border-b-[14px] border-[#340c24]"
    >
      <img
        src="/images/hero-night.webp"
        alt="Kaze Sanctuary twilight thermal infinity pool and cedar pavilion"
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover parallax-img"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[#17233b]/90 via-[#17233b]/35 to-[#17233b]/40" />

      {/* Top right interactive amenity index */}
      <div className="relative z-10 max-w-7xl w-full mx-auto px-6 sm:px-10 pt-16 sm:pt-24 flex justify-end">
        <div className="border-l border-white/40 pl-5 space-y-2 text-left">
          {AMENITIES.map((item) => {
            const selected = item.id === activeId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveId(item.id)}
                onMouseEnter={() => setActiveId(item.id)}
                className={`block font-display text-2xl sm:text-4xl tracking-tight leading-none transition-all duration-300 cursor-pointer text-left ${
                  selected
                    ? "text-white translate-x-1.5"
                    : "text-white/45 hover:text-white/80"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom statement + circular Book a Visit button */}
      <div className="relative z-10 max-w-7xl w-full mx-auto px-6 sm:px-10 pb-14 sm:pb-20 pt-16 flex flex-col md:flex-row md:items-end justify-between gap-10">
        <div className="max-w-2xl">
          <p className="font-micro text-[10px] tracking-[0.28em] text-[#b5cedb] mb-3">
            {current.eyebrow}
          </p>
          <p className="font-display text-3xl sm:text-5xl leading-[1.02] uppercase text-white transition-opacity duration-500">
            {current.quote}
          </p>
          <p className="mt-4 text-xs sm:text-sm text-white/75 max-w-md">
            {current.detail}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onOpenBooking()}
          className="shrink-0 w-36 h-36 sm:w-44 sm:h-44 rounded-full border border-white/60 bg-white/5 hover:bg-[#f3f3ec] hover:text-[#340c24] backdrop-blur-sm flex items-center justify-center text-center px-6 font-micro text-[10px] tracking-[0.22em] transition-all duration-500 cursor-pointer"
        >
          BOOK A PRIVATE
          <br />
          TOUR NOW
        </button>
      </div>
    </section>
  );
}
