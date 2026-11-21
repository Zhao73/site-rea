import React, { useState } from "react";
import { Sun, Moon, X, ArrowUpRight } from "lucide-react";
import { RotatingSeal, CrestMark } from "./CrestEmblem.jsx";

const NAV_LINKS = [
  { label: "The Sanctuary", href: "#hero" },
  { label: "Three Pillars", href: "#pillars" },
  { label: "The Philosophy", href: "#philosophy" },
  { label: "Pavilions", href: "#pavilions" },
  { label: "Thermal & Gardens", href: "#amenities" },
  { label: "Craft & Interiors", href: "#interiors" },
  { label: "Architecture", href: "#architecture" },
];

export function Navbar({
  ambiance,
  onToggleAmbiance,
  onOpenBooking,
  onScrollTo,
  isLightHeader,
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const inkClass = isLightHeader ? "text-[#17233b]" : "text-white";
  const sealColor = isLightHeader ? "#17233b" : "#ffffff";
  const pillBorder = isLightHeader
    ? "border-[#17233b]/25 bg-[#f3f3ec]/80 text-[#17233b]"
    : "border-white/30 bg-[#17233b]/30 text-white";

  return (
    <>
      <header className="fixed top-0 inset-x-0 z-40 px-5 sm:px-9 py-4 flex items-center justify-between pointer-events-none">
        <div className="pointer-events-auto">
          <RotatingSeal
            className="w-16 h-16 sm:w-20 sm:h-20"
            color={sealColor}
            onClick={() => onScrollTo("#hero")}
          />
        </div>

        <div className="pointer-events-auto flex items-center gap-2.5 sm:gap-4">
          {/* Interactive Day / Twilight mood toggle */}
          <button
            type="button"
            onClick={onToggleAmbiance}
            aria-label="Toggle Day or Twilight ambiance"
            className={`inline-flex items-center gap-2 rounded-full border backdrop-blur-md px-3.5 py-2 text-[10px] font-micro tracking-[0.2em] transition-all duration-300 cursor-pointer hover:scale-[1.02] ${pillBorder}`}
          >
            {ambiance === "day" ? (
              <>
                <Sun className="w-3.5 h-3.5" />
                <span>DAYLIGHT</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5" />
                <span>TWILIGHT</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => onScrollTo("#pavilions")}
            className={`hidden md:inline-block font-micro text-[10px] tracking-[0.22em] hover:opacity-70 transition-opacity cursor-pointer ${inkClass}`}
          >
            SELECT A PAVILION
          </button>

          <button
            type="button"
            onClick={() => onOpenBooking()}
            className={`hidden sm:inline-flex items-center gap-1.5 rounded-full border backdrop-blur-md px-4 py-2 font-micro text-[10px] tracking-[0.2em] transition-all cursor-pointer hover:bg-[#340c24] hover:text-[#f3f3ec] hover:border-[#340c24] ${pillBorder}`}
          >
            BOOK A VISIT
            <ArrowUpRight className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open navigation menu"
            className={`inline-flex items-center gap-2.5 px-3 py-2 font-micro text-[10px] tracking-[0.22em] cursor-pointer hover:opacity-75 transition-opacity ${inkClass}`}
          >
            <span>MENU</span>
            <span className="flex flex-col gap-1">
              <span className="w-1 h-1 rounded-full bg-current" />
              <span className="w-1 h-1 rounded-full bg-current" />
              <span className="w-1 h-1 rounded-full bg-current" />
            </span>
          </button>
        </div>
      </header>

      {/* Full-screen deep plum menu overlay */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 bg-[#340c24] text-[#f3f3ec] flex flex-col justify-between p-6 sm:p-12 animate-fadeIn">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CrestMark className="w-8 h-8" color="#f3f3ec" />
              <span className="font-micro text-[10px] tracking-[0.28em] text-[#f3f3ec]/70">
                KAZE SANCTUARY · KYOTO
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="inline-flex items-center gap-2 rounded-full border border-[#f3f3ec]/25 px-4 py-2 font-micro text-[10px] tracking-[0.22em] hover:bg-[#f3f3ec] hover:text-[#340c24] transition-colors cursor-pointer"
            >
              <span>CLOSE</span>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <nav className="my-auto grid grid-cols-1 md:grid-cols-12 gap-10 items-end">
            <ul className="md:col-span-7 space-y-2 sm:space-y-3">
              {NAV_LINKS.map((item, idx) => (
                <li key={item.href}>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onScrollTo(item.href);
                    }}
                    className="group flex items-baseline gap-4 text-left cursor-pointer"
                  >
                    <span className="font-micro text-[10px] text-[#f3f3ec]/45">
                      0{idx + 1}
                    </span>
                    <span className="font-display text-4xl sm:text-6xl text-[#f3f3ec] group-hover:italic group-hover:translate-x-2 transition-all duration-300">
                      {item.label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <div className="md:col-span-5 border-t md:border-t-0 md:border-l border-[#f3f3ec]/15 pt-6 md:pt-0 md:pl-10 space-y-6">
              <div>
                <p className="font-micro text-[10px] text-[#f3f3ec]/50 mb-2">
                  PRIVATE GALLERY · ARASHIYAMA
                </p>
                <p className="text-sm text-[#f3f3ec]/85 leading-relaxed">
                  14 Sagatenryuji Susukinobabacho, Ukyo Ward, Kyoto 616-8385, Japan
                </p>
                <p className="text-sm text-[#f3f3ec]/85 mt-1">+81 (75) 555-0194</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenBooking();
                }}
                className="inline-flex items-center gap-2 rounded-full bg-[#f3f3ec] text-[#340c24] px-6 py-3 font-micro text-[10px] font-medium tracking-[0.22em] hover:bg-[#b5cedb] transition-colors cursor-pointer"
              >
                SCHEDULE PRIVATE VIEWING
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </nav>

          <div className="flex flex-wrap items-center justify-between gap-4 text-[10px] font-micro text-[#f3f3ec]/45">
            <span>18 PRIVATE PAVILIONS · COMPLETION 2027</span>
            <span>ORIGINAL SOURCE REBUILD · POWERED BY SITE-REA</span>
          </div>
        </div>
      )}
    </>
  );
}
