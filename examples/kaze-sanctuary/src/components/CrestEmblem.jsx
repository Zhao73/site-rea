import React from "react";

/** Original geometric Kyoto lattice-petal crest for KAZE Sanctuary. */
export function CrestMark({ className = "w-8 h-8", color = "currentColor" }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Four cardinal botanical diamond petals */}
      <path
        d="M32 6C35.8 14.5 37.5 21 32 28C26.5 21 28.2 14.5 32 6Z"
        stroke={color}
        strokeWidth="1.75"
      />
      <path
        d="M32 58C28.2 49.5 26.5 43 32 36C37.5 43 35.8 49.5 32 58Z"
        stroke={color}
        strokeWidth="1.75"
      />
      <path
        d="M6 32C14.5 28.2 21 26.5 28 32C21 37.5 14.5 35.8 6 32Z"
        stroke={color}
        strokeWidth="1.75"
      />
      <path
        d="M58 32C49.5 35.8 43 37.5 36 32C43 26.5 49.5 28.2 58 32Z"
        stroke={color}
        strokeWidth="1.75"
      />
      {/* Four diagonal slender leaves */}
      <path
        d="M14 14C20 17 24 21 27 27C21 24 17 20 14 14Z"
        stroke={color}
        strokeWidth="1.4"
      />
      <path
        d="M50 14C47 20 43 24 37 27C40 21 44 17 50 14Z"
        stroke={color}
        strokeWidth="1.4"
      />
      <path
        d="M14 50C17 44 21 40 27 37C24 43 20 47 14 50Z"
        stroke={color}
        strokeWidth="1.4"
      />
      <path
        d="M50 50C44 47 40 43 37 37C43 40 47 44 50 50Z"
        stroke={color}
        strokeWidth="1.4"
      />
      <circle cx="32" cy="32" r="2.2" fill={color} />
    </svg>
  );
}

/** Rotating circular seal emblem for navbar & hero. */
export function RotatingSeal({ className = "w-20 h-20", color = "#ffffff", onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="KAZE Sanctuary — Return to top"
      className={`group relative inline-flex items-center justify-center cursor-pointer focus:outline-none ${className}`}
    >
      <svg
        viewBox="0 0 120 120"
        className="w-full h-full animate-spin-slow"
        aria-hidden="true"
      >
        <defs>
          <path
            id="kaze-seal-circle"
            d="M 60, 60 m -44, 0 a 44,44 0 1,1 88,0 a 44,44 0 1,1 -88,0"
          />
        </defs>
        <text
          fill={color}
          fontSize="7.6"
          fontWeight="500"
          letterSpacing="2.1"
          className="uppercase"
        >
          <textPath href="#kaze-seal-circle" startOffset="0%">
            KAZE SANCTUARY · ARASHIYAMA · KYOTO ·
          </textPath>
        </text>
      </svg>
      <CrestMark
        className="w-7 h-7 absolute transition-transform duration-500 group-hover:scale-110"
        color={color}
      />
    </button>
  );
}
