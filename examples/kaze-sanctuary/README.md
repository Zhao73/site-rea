# KAZE Sanctuary — Site-REA Creative Secondary Development Example

A **100% original-source** editorial architecture website built with **React 19 + Vite + Tailwind CSS v4 + GSAP ScrollTrigger + Lenis**, created by extracting the design grammar, color tokens, typography pairing, and scroll choreography of `era-residence.com` with **Site-REA** and re-authoring every component, copy line, SVG emblem, image, and interactive feature from scratch.

## What was extracted with Site-REA vs. newly authored

| Dimension | Extracted via Site-REA evidence | Newly authored in `examples/kaze-sanctuary` |
| :--- | :--- | :--- |
| **Color tokens** | `#340c24`, `#f3f3ec`, `#b5cedb`, `#17233b` (`design-tokens.json`) | CSS custom properties & Tailwind utilities |
| **Typography rhythm** | High-contrast display serif + tilted calligraphy script + tracked uppercase sans | Open-source Google Fonts (`Instrument Serif` + `Pinyon Script` + `Plus Jakarta Sans`) |
| **Motion & layout** | Arch preloader, rounded sky dome, asymmetric spec showcase, swaying corner botanicals, GSAP + Lenis (`rich-media.json`, `blueprint.json`) | Clean modular React components with GSAP ScrollTrigger + Lenis + procedural drifting-petal canvas |
| **Assets & brand** | Reference layout structure only (zero third-party files copied) | Brand-new brand (**KAZE Sanctuary · Arashiyama, Kyoto**), original geometric SVG crest, 8 newly generated WebP visuals |
| **New interactivity** | — | Day / Twilight hero switcher, interactive architectural hotspots, 3-typology pavilion slider + floorplan drawer, clickable twilight amenity switcher, 3-slide interior gallery, working private viewing modal |

## Run locally

```bash
cd examples/kaze-sanctuary
npm install
npm run dev
```

Open http://127.0.0.1:4180/ (append `?instant=1` to skip the opening plum curtain).
