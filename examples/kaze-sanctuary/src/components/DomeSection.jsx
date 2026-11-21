import React from "react";
import { CrestMark } from "./CrestEmblem.jsx";

/**
 * Iconic rounded sky-blue dome emerging from the deep-plum floor,
 * crowned with curved SVG editorial typography.
 */
export function DomeSection() {
  return (
    <section id="pillars" className="relative bg-[#340c24] pt-20 sm:pt-32 overflow-hidden">
      <div className="dome-arch bg-[#b5cedb] text-[#17233b] pt-20 sm:pt-28 pb-20 sm:pb-28 px-6 flex flex-col items-center">
        {/* Curved SVG Arch Heading */}
        <svg
          viewBox="0 0 900 260"
          className="w-full max-w-[820px] h-auto overflow-visible"
          aria-label="Three pillars of Kaze Sanctuary"
        >
          <defs>
            <path
              id="kaze-dome-arc"
              d="M 60,250 A 420,420 0 0,1 840,250"
              fill="none"
            />
          </defs>
          <text
            fill="#17233b"
            className="font-display uppercase"
            fontSize="54"
            letterSpacing="2"
          >
            <textPath href="#kaze-dome-arc" startOffset="50%" textAnchor="middle">
              THREE PILLARS OF KAZE SANCTUARY
            </textPath>
          </text>
        </svg>

        {/* Crest + Kyoto coordinates */}
        <div className="-mt-10 sm:-mt-16 flex items-center gap-6 sm:gap-10">
          <span className="font-micro text-[10px] tracking-[0.28em] font-medium">
            ARASHIYAMA
          </span>
          <CrestMark className="w-9 h-9" color="#17233b" />
          <span className="font-micro text-[10px] tracking-[0.28em] font-medium">
            KYOTO
          </span>
        </div>

        {/* Hairline vertical rule */}
        <div className="my-10 sm:my-14 w-px h-32 sm:h-44 bg-[#17233b]/55" />

        <p className="font-micro text-[10px] sm:text-[11px] tracking-[0.28em] text-center max-w-md leading-relaxed font-medium">
          A SANCTUARY TO LIVE — TO RETURN
          <br />
          SEASON AFTER SEASON
        </p>
      </div>
    </section>
  );
}
