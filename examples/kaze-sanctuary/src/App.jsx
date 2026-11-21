import React, { useEffect, useRef, useState } from "react";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { PreloaderCurtain } from "./components/PreloaderCurtain.jsx";
import { Navbar } from "./components/Navbar.jsx";
import { HeroSection } from "./components/HeroSection.jsx";
import { DomeSection } from "./components/DomeSection.jsx";
import { LocationSection } from "./components/LocationSection.jsx";
import { PhilosophySection } from "./components/PhilosophySection.jsx";
import { PanoramaSection } from "./components/PanoramaSection.jsx";
import { PavilionsSection } from "./components/PavilionsSection.jsx";
import { InterludeSection } from "./components/InterludeSection.jsx";
import { AmenitiesSection } from "./components/AmenitiesSection.jsx";
import { InteriorsSection } from "./components/InteriorsSection.jsx";
import { ArchitectureSection } from "./components/ArchitectureSection.jsx";
import { FooterSection } from "./components/FooterSection.jsx";
import { BookingModal } from "./components/BookingModal.jsx";
import { CookieBanner } from "./components/CookieBanner.jsx";

gsap.registerPlugin(ScrollTrigger);

export default function App() {
  const skipIntro =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("instant") === "1";

  const [curtainOpen, setCurtainOpen] = useState(!skipIntro);
  const [ambiance, setAmbiance] = useState("day");
  const [bookingOpen, setBookingOpen] = useState(false);
  const [selectedPavilion, setSelectedPavilion] = useState("");
  const [isLightHeader, setIsLightHeader] = useState(false);
  const lenisRef = useRef(null);
  const rootRef = useRef(null);

  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.15,
      smoothWheel: true,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    });
    lenisRef.current = lenis;

    const onTick = (time) => lenis.raf(time * 1000);
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(onTick);
    gsap.ticker.lagSmoothing(0);

    const ctx = gsap.context(() => {
      // Staggered editorial reveals
      gsap.utils.toArray(".reveal-up").forEach((el) => {
        gsap.fromTo(
          el,
          { y: 36, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.95,
            ease: "power3.out",
            scrollTrigger: {
              trigger: el,
              start: "top 86%",
              once: true,
            },
          }
        );
      });

      // Subtle editorial parallax on architectural imagery
      gsap.utils.toArray(".parallax-img").forEach((img) => {
        gsap.fromTo(
          img,
          { yPercent: -6, scale: 1.08 },
          {
            yPercent: 6,
            scale: 1.08,
            ease: "none",
            scrollTrigger: {
              trigger: img.parentElement,
              start: "top bottom",
              end: "bottom top",
              scrub: true,
            },
          }
        );
      });

      // Adapt navbar ink color accurately over light sections only
      const lightSections = ["#pillars .dome-arch", "#philosophy", "#pavilions", "#interiors"];
      lightSections.forEach((sel) => {
        const el = document.querySelector(sel);
        if (!el) return;
        ScrollTrigger.create({
          trigger: el,
          start: "top 64px",
          end: "bottom 64px",
          onEnter: () => setIsLightHeader(true),
          onEnterBack: () => setIsLightHeader(true),
          onLeave: () => setIsLightHeader(false),
          onLeaveBack: () => setIsLightHeader(false),
        });
      });
    }, rootRef);

    return () => {
      ctx.revert();
      gsap.ticker.remove(onTick);
      lenis.destroy();
    };
  }, []);

  const scrollTo = (target) => {
    const el = document.querySelector(target);
    if (!el) return;
    if (lenisRef.current) {
      lenisRef.current.scrollTo(el, { duration: 1.3 });
    } else {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  const openBooking = (pavilionName = "") => {
    setSelectedPavilion(pavilionName);
    setBookingOpen(true);
  };

  return (
    <div ref={rootRef} className="min-h-screen bg-[#f3f3ec] text-[#17233b]">
      <PreloaderCurtain
        open={curtainOpen}
        onDismiss={() => setCurtainOpen(false)}
      />

      <Navbar
        ambiance={ambiance}
        onToggleAmbiance={() =>
          setAmbiance((m) => (m === "day" ? "night" : "day"))
        }
        onOpenBooking={openBooking}
        onScrollTo={scrollTo}
        isLightHeader={isLightHeader}
      />

      <main>
        <HeroSection
          ambiance={ambiance}
          onOpenBooking={openBooking}
          onScrollTo={scrollTo}
        />
        <DomeSection />
        <LocationSection />
        <PhilosophySection />
        <PanoramaSection />
        <PavilionsSection onSelectForBooking={openBooking} />
        <InterludeSection />
        <AmenitiesSection onOpenBooking={openBooking} />
        <InteriorsSection onScrollTo={scrollTo} />
        <ArchitectureSection onOpenBooking={openBooking} />
      </main>

      <FooterSection
        onScrollTo={scrollTo}
        onOpenBooking={openBooking}
        onReplayCurtain={() => {
          scrollTo("#hero");
          setCurtainOpen(true);
        }}
      />

      <BookingModal
        open={bookingOpen}
        defaultPavilion={selectedPavilion}
        onClose={() => setBookingOpen(false)}
      />

      <CookieBanner />
    </div>
  );
}
