import React, { useState } from "react";

export function CookieBanner() {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;

  return (
    <aside
      aria-label="Privacy notice"
      className="fixed bottom-5 right-5 z-30 w-72 sm:w-80 bg-[#f3f3ec]/95 backdrop-blur-md text-[#17233b] border border-[#17233b]/15 p-5 shadow-[0_18px_50px_rgba(23,35,59,0.2)]"
    >
      <p className="font-script text-4xl leading-none text-[#17233b] -mt-1 mb-2">
        Stillness
      </p>
      <p className="font-micro text-[9px] tracking-[0.18em] leading-relaxed text-[#17233b]/80">
        THIS SHOWCASE RUNS 100% LOCALLY WITH ZERO THIRD-PARTY TRACKERS.
      </p>
      <div className="mt-4 flex items-center gap-3 font-display text-lg">
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="underline underline-offset-4 hover:text-[#340c24] cursor-pointer"
        >
          ACCEPT
        </button>
        <span className="opacity-35">/</span>
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="underline underline-offset-4 opacity-70 hover:opacity-100 cursor-pointer"
        >
          DISMISS
        </button>
      </div>
    </aside>
  );
}
