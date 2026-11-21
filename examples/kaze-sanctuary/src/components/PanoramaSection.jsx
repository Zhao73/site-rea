import React from "react";

export function PanoramaSection() {
  return (
    <section className="relative w-full overflow-hidden bg-[#340c24]">
      <div className="relative h-[86vh] min-h-[580px] w-full overflow-hidden">
        <img
          src="/images/kyoto-panorama.webp"
          alt="Aerial panorama of Arashiyama cedar mountains and emerald Katsura river in Kyoto"
          loading="lazy"
          className="w-full h-full object-cover parallax-img"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#340c24]/85 via-transparent to-[#f3f3ec]/25" />

        {/* Editorial vertical coordinate callout (matching lower-right pinned line) */}
        <div className="absolute bottom-10 right-6 sm:right-16 md:right-28 z-10 border-l border-white/75 pl-4 text-white">
          <p className="font-micro text-[10px] tracking-[0.24em] font-semibold">
            ARASHIYAMA VALLEY,
            <br />
            KYOTO
          </p>
          <p className="mt-4 text-xs text-white/85">Katsura River Foothills</p>
          <p className="mt-2 text-xs text-white/75">Japan · 35°00&apos;N 135°40&apos;E</p>
        </div>
      </div>

      {/* Plum-to-sky architectural bevel transition */}
      <div className="h-12 bg-[#340c24] relative">
        <div
          className="absolute inset-x-4 sm:inset-x-8 bottom-0 h-6 bg-[#b5cedb]"
          style={{ clipPath: "polygon(18px 0, calc(100% - 18px) 0, 100% 100%, 0 100%)" }}
        />
      </div>
    </section>
  );
}
