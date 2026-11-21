import React, { useEffect, useRef } from "react";

/**
 * Animated transparent botanical branch accent.
 * Uses our original alpha-cutout WebP with organic wind-sway keyframes.
 */
export function BlossomCorner({
  position = "top-left",
  className = "",
  opacity = 0.96,
}) {
  const presets = {
    "top-left":
      "top-0 left-0 w-[280px] sm:w-[390px] lg:w-[470px] -translate-x-6 -translate-y-6 animate-sway-a",
    "bottom-right":
      "bottom-0 right-0 w-[260px] sm:w-[360px] lg:w-[440px] translate-x-6 translate-y-8 animate-sway-b",
    "bottom-left":
      "bottom-0 left-0 w-[260px] sm:w-[370px] lg:w-[440px] -translate-x-8 translate-y-8 animate-sway-a",
    "top-right":
      "top-0 right-0 w-[260px] sm:w-[370px] lg:w-[440px] translate-x-6 -translate-y-6 animate-sway-b",
  };

  return (
    <div
      className={`pointer-events-none select-none absolute z-20 ${presets[position] || presets["top-left"]} ${className}`}
      style={{ opacity }}
      aria-hidden="true"
    >
      <img
        src="/images/blossom-branch.webp"
        alt=""
        loading="lazy"
        decoding="async"
        className="w-full h-auto drop-shadow-[0_14px_24px_rgba(52,12,36,0.16)]"
      />
    </div>
  );
}

/**
 * Lightweight procedural Canvas layer rendering slow drifting Kyoto petals
 * inside key botanical sections (zero video bandwidth, 60fps smooth).
 */
export function DriftingPetalsCanvas({ count = 14, className = "" }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let rafId = 0;
    let width = (canvas.width = canvas.offsetWidth);
    let height = (canvas.height = canvas.offsetHeight);

    const petals = Array.from({ length: count }, (_, idx) => ({
      x: ((idx * 137.5) % 100) * 0.01 * width,
      y: ((idx * 61.8) % 100) * 0.01 * height,
      r: 3.5 + (idx % 5) * 1.4,
      vx: 0.22 + (idx % 4) * 0.1,
      vy: 0.35 + (idx % 3) * 0.14,
      angle: idx * 0.8,
      spin: (idx % 2 === 0 ? 1 : -1) * (0.008 + (idx % 4) * 0.004),
      alpha: 0.25 + (idx % 4) * 0.12,
      hue: idx % 3 === 0 ? "#c82368" : idx % 3 === 1 ? "#e05894" : "#b81d5c",
    }));

    const onResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
    };
    window.addEventListener("resize", onResize);

    const tick = (t) => {
      ctx.clearRect(0, 0, width, height);
      for (const p of petals) {
        p.x += p.vx + Math.sin(t * 0.0007 + p.angle) * 0.3;
        p.y += p.vy;
        p.angle += p.spin;
        if (p.y > height + 20) {
          p.y = -20;
          p.x = Math.random() * width;
        }
        if (p.x > width + 20) p.x = -20;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.hue;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r, p.r * 0.56, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
    };
  }, [count]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 w-full h-full z-10 ${className}`}
    />
  );
}
