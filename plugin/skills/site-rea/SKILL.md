---
name: site-rea
description: Capture a live website (or a user-saved HTML/HAR archive) with the Site-REA MCP tools, replay it offline as a runtime mirror, turn it into a static or React project, and verify the result against the original with the internet cut off. Use when the user gives a URL or local archive and asks to copy, clone, mirror, archive or rebuild a website.
---

# Site REA playbook

Site-REA produces evidence first and projects second. Every project is checked by `verify_clone`, which cuts the internet off for anything served locally. Report the numbers it returns; never round them up.

## 1. Capture

Put the project in the active workspace (in Antigravity with no workspace: `~/.gemini/antigravity/scratch/cloned-<domain>/`; otherwise ask the user for a folder) and the evidence in `<target_dir>/.site-rea/`.

If the `site-rea` MCP tools are not available, the same steps exist as CLI commands: `site-rea capture <url> --out <dir> --deterministic`, `site-rea scaffold <evidence> <target> --mode <mode>`, `site-rea verify <evidence> --dir <target>` (see `site-rea help`).

Live URL — `capture_site`:
```json
{ "url": "<url>", "output_dir": "<target_dir>/.site-rea", "deterministic": true }
```
Set `deterministic: true` whenever you will run `verify_clone` on a page that moves (carousels, animation, WebGL, video). It makes the original and the clone be photographed in the same state. It also holds timers of 2.4 s or longer, so delayed pop-ups do not appear in the screenshots.

Read these fields of the result:
- `status: "blocked"` — a CAPTCHA, bot check or login wall. Stop and tell the user. Never try to get around it. The user may save the page from their own browser (HTML, SingleFile or HAR) and you then use `ingest_local_archive`.
- `runtimeCache.rehearsal.unresolvedCount` — requests the offline rehearsal could not record. Zero means the mirror has everything the page asked for during the rehearsal.
- `warnings` — pass them on.

Local archive — `ingest_local_archive` with `html_path` and/or `har_path`. Nothing is fetched from the network. A HAR that contains the page becomes a runtime-cache too.

## 2. Choose what to build

| The user wants | Build | What it is |
| :--- | :--- | :--- |
| The site running locally exactly as it is, scripts included (3D, animation, SPA) | `scaffold_project` mode `runtime-mirror` | The recording plus `server.mjs`. Original JavaScript runs against recorded responses. |
| A frozen picture of the page as HTML | `static-mirror` | Rendered DOM + the site's CSS, no scripts. |
| Source to continue working on | `vanilla` or `react-vite-tailwind` | The captured markup split into labelled blocks (vanilla) or one React component per block, with the site's own CSS. |
| A scroll-driven 3D/video sequence as a lightweight film | `capture_scroll_scrub` then mode `scroll-scrub` | Recorded frames played on a canvas while scrolling. |
| A fake backend for recorded JSON APIs | `scaffold_mock_backend` | Local CRUD server generated from redacted API samples. |

State your choice in one sentence. What each mode does not do:
- `static-mirror`, `vanilla`, `react-vite-tailwind` have no behaviour: menus, sliders, tabs and forms do nothing until someone writes them. They are a snapshot of the desktop layout; a site that rebuilds its DOM by script on phones will not match on mobile.
- `react-vite-tailwind` class names are the original site's. Tailwind is installed with the prefix `tw:` and without Preflight so it cannot restyle the captured page.
- `scroll-scrub` is a film: fixed viewport size, nothing clickable, no selectable text.
- `runtime-mirror` cannot replay live connections (WebSocket), requests the page never made during capture, or anything behind a login it did not have.

For 3D pages, `inspect_rich_media` lists captured GLSL/WGSL shaders, the Three.js scene graph and per-scroll camera/mesh/uniform tracks, and `capture_scroll_timeline` samples more scroll stops. These are reference material for a manual rebuild; no mode generates a Three.js scene from them.

## 3. Verify

`verify_clone` with `clone_dir` (for React: run `npm install && npm run build`, pass `<target_dir>/dist`).

- `offline.passed` — false means the clone asked for something that is not local; `offline.externalRequests` / `offline.misses` name it.
- For a runtime mirror, `replayModes.exact` is the recording answering under the real URL (what `site-rea open <dir>` shows the user) and `replayModes.portable` is `node server.mjs` on 127.0.0.1. Pages that check their own domain or cookies, and third-party iframes, only behave fully in `exact`.
- `heroDiff`, `fullDiff`, `sectionDiffs`, `scrollTimelineDiffs` — pixel similarity. Open the worst `compare-*.png` (Original | Diff | Clone) before explaining a low number.
- `issues` — console errors, broken images, overflow. Errors the original page logged itself are already excluded.

## 4. Report

Give the user: the mode and why, the path to the project, how to open it (`node <dir>/server.mjs` for a runtime mirror, or `site-rea open <dir>` for exact-origin replay — its window is known not to appear on some macOS setups, `site-rea serve <dir>` for static projects, `npm run dev` for React), the measured numbers for both viewports, and everything that does not work, in plain words.

Cloning a site you do not own for publication can infringe copyright and trademarks. Mirrors are for reference, archiving, and moving a client's own site.
