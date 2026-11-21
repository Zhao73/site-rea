import React from "react";
import { BlossomCorner, DriftingPetalsCanvas } from "./BlossomLayer.jsx";

export function ArchitectureSection({ onOpenBooking }) {
  return (
    <section
      id="architecture"
      className="relative min-h-[95vh] w-full overflow-hidden bg-[#17233b] text-white flex flex-col justify-between"
    >
      <img
        src="/images/architecture-facade.webp"
        alt="Stepped contemporary limestone and cedar architecture of Kaze Sanctuary"
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover parallax-img"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[#17233b]/35 via-[#17233b]/20 to-[#17233b]/80" />

      <DriftingPetalsCanvas count={10} />
      <BlossomCorner position="top-left" className="w-56 sm:w-72 -translate-x-10 -translate-y-4" opacity={0.9} />
      <BlossomCorner position="top-right" className="w-56 sm:w-72 translate-x-10 -translate-y-4" opacity={0.9} />

      {/* Edge-to-edge monumental ARCHITECTURE header */}
      <div className="relative z-20 pt-20 sm:pt-24 px-4 text-center overflow-hidden">
        <h2 className="reveal-up font-display text-[14.5vw] lg:text-[172px] leading-[0.82] uppercase tracking-[-0.03em] text-white/95 drop-shadow-[0_10px_30px_rgba(23,35,59,0.35)]">
          ARCHITECTURE
        </h2>
      </div>

      {/* Bottom editorial statement + circular Book a Call */}
      <div className="relative z-20 max-w-7xl w-full mx-auto px-6 sm:px-10 pb-16 sm:pb-24 pt-20 flex flex-col md:flex-row md:items-end justify-between gap-10">
        <div className="max-w-xl space-y-6">
          <p className="font-display text-3xl sm:text-5xl leading-[1.02] uppercase">
            THE ARCHITECTURE OF KAZE SANCTUARY BALANCES CLEAN GEOMETRIC
            CANTILEVERS WITH WARM LIMESTONE, CEDAR AND LIVING FOLIAGE
          </p>
          <p className="font-micro text-[10px] tracking-[0.26em] text-white/75 leading-relaxed">
            ARCHITECTURAL DIRECTION · KAZE ATELIER KYOTO
            <br />
            LANDSCAPE DESIGN · HARUKA MOSS STUDIO
          </p>
        </div>

        <button
          type="button"
          onClick={() => onOpenBooking()}
          className="shrink-0 w-36 h-36 sm:w-44 sm:h-44 rounded-full border border-white/65 bg-white/10 hover:bg-[#f3f3ec] hover:text-[#340c24] backdrop-blur-sm flex items-center justify-center text-center px-6 font-micro text-[10px] tracking-[0.22em] transition-all duration-500 cursor-pointer"
        >
          BOOK A CALL
          <br />
          NOW
        </button>
      </div>
    </section>
  );
}
