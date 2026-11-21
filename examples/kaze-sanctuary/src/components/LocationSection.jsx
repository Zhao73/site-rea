import React from "react";

export function LocationSection() {
  return (
    <section className="relative bg-[#b5cedb] text-[#17233b]">
      {/* Monumental display header + framed architecture window */}
      <div className="max-w-6xl mx-auto px-6 pt-6 pb-20 sm:pb-28 text-center">
        <div className="reveal-up">
          <h2 className="font-display text-6xl sm:text-8xl lg:text-[128px] leading-[0.88] uppercase">
            TIMELESS
            <br />
            SETTING
          </h2>
        </div>

        <div className="reveal-up mt-12 sm:mt-16 mx-auto max-w-xl overflow-hidden shadow-[0_24px_60px_rgba(23,35,59,0.18)]">
          <img
            src="/images/architecture-facade.webp"
            alt="Stepped limestone and cedar residences framed by garden greenery"
            loading="lazy"
            className="w-full h-64 sm:h-80 object-cover parallax-img hover:scale-105 transition-transform duration-700"
          />
        </div>

        <p className="reveal-up mt-12 sm:mt-16 mx-auto max-w-xl text-sm sm:text-base leading-relaxed text-[#17233b]/85">
          Nestled between bamboo groves, Katsura river trails, and ancient Zen
          temple gardens, Kaze Sanctuary offers a rare balance of quiet seclusion
          and effortless connection to Kyoto&apos;s finest cultural life.
        </p>

        <p className="mt-8 font-micro text-[10px] tracking-[0.26em] font-semibold">
          COMPOSED AS A VILLAGE,
          <br />
          NEVER A COMPLEX
        </p>
      </div>

      {/* Full-bleed daylight pavilion quote frame */}
      <div className="relative h-[78vh] min-h-[540px] w-full overflow-hidden">
        <img
          src="/images/hero-day.webp"
          alt="Kaze Sanctuary daylight reflecting pool and cedar pergola"
          loading="lazy"
          className="w-full h-full object-cover parallax-img"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#17233b]/75 via-[#17233b]/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 max-w-6xl mx-auto px-6 sm:px-10 pb-12 sm:pb-16 flex justify-end">
          <blockquote className="max-w-xl text-white">
            <span className="font-display text-5xl leading-none opacity-80 block mb-2">
              “
            </span>
            <p className="font-display text-2xl sm:text-4xl leading-[1.08] uppercase tracking-tight">
              Instead of corridors, moss stone paths connect the pavilions —
              making Kaze Sanctuary feel closer to a gathering of private
              residences than a standard development.
            </p>
          </blockquote>
        </div>
      </div>
    </section>
  );
}
