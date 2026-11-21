import React from "react";
import { CrestMark } from "./CrestEmblem.jsx";
import { BlossomCorner } from "./BlossomLayer.jsx";

export function InterludeSection() {
  return (
    <section className="relative bg-[#b5cedb] text-[#17233b] py-24 sm:py-36 px-6 overflow-hidden">
      <BlossomCorner position="bottom-left" opacity={0.95} />

      <div className="relative z-10 max-w-4xl mx-auto flex flex-col items-center text-center">
        <div className="w-px h-28 sm:h-36 bg-[#17233b]/50 mb-8" />

        <p className="font-micro text-[10px] tracking-[0.28em] font-semibold mb-10">
          A SANCTUARY TO LIVE — TO RETURN
          <br />
          SEASON AFTER SEASON
        </p>

        <h2 className="reveal-up font-display text-4xl sm:text-6xl lg:text-[72px] leading-[0.94] uppercase">
          PAVILIONS RANGE FROM 142 TO 268 SQ.M., OFFERING SINGLE-LEVEL
          SANCTUARIES AND DUPLEX COURTYARDS WITH PRIVATE THERMAL BATHS.
        </h2>

        <div className="mt-12">
          <CrestMark className="w-9 h-9" color="#17233b" />
        </div>
      </div>
    </section>
  );
}
