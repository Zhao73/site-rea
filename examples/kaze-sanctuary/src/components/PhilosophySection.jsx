import React from "react";
import { CrestMark } from "./CrestEmblem.jsx";
import { BlossomCorner, DriftingPetalsCanvas } from "./BlossomLayer.jsx";

export function PhilosophySection() {
  return (
    <section
      id="philosophy"
      className="relative bg-[#f3f3ec] text-[#17233b] py-28 sm:py-40 px-6 overflow-hidden"
    >
      <DriftingPetalsCanvas count={12} />
      <BlossomCorner position="top-left" />
      <BlossomCorner position="bottom-right" />

      <div className="relative z-10 max-w-4xl mx-auto text-center">
        <p className="font-micro text-[10px] tracking-[0.28em] font-semibold mb-8">
          THE PHILOSOPHY
        </p>

        <h2 className="reveal-up font-display text-4xl sm:text-6xl lg:text-[74px] leading-[0.95] uppercase text-[#17233b]">
          KAZE SANCTUARY IS AN INTIMATE WALLED ENCLAVE OF ONLY 18 PAVILIONS,
          CRAFTED AROUND STILLNESS, NATURAL LIGHT AND TIMELESS KYOTO LIVING
        </h2>

        <p className="reveal-up mt-10 mx-auto max-w-md text-sm leading-relaxed text-[#17233b]/75">
          Guided by the proportion of traditional Kyoto tea architecture, every
          residence pairs honed limestone with fragrant hinoki cedar, quiet
          courtyards, and seasonal botanical terraces.
        </p>

        <div className="mt-10 flex justify-center">
          <CrestMark className="w-9 h-9" color="#17233b" />
        </div>
      </div>
    </section>
  );
}
