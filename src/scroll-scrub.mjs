import fs from "node:fs";
import path from "node:path";
import { launchBrowser, detectBlockedPage, scrollAndSettlePage } from "./browser.mjs";
import { buildDeterministicClockInitScript, lockDeterministicFrame, getEvidenceClock, FIRST_LOCK_MS } from "./deterministic-clock.mjs";

/**
 * Route C — Apple-style Scroll-Scrub Canvas Sequence Recorder & Player Generator.
 * Deterministically samples `frameCount` frames (e.g. 60-120) from scroll 0% -> 100%
 * and outputs a drop-in HiDPI <canvas> scroll-scrub player with smooth interpolation.
 */
export async function captureScrollScrub({
  url,
  evidenceDir,
  frameCount = 60,
  selector = null,
  format = "jpeg",
  quality = 90,
  viewport = "desktop",
  deterministic = true,
  settleMs = 80,
  timeoutMs = 45000,
} = {}) {
  if (!url) throw new Error("url is required");
  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = `https://${normalizedUrl}`;

  const resolvedEvidence = path.resolve(evidenceDir);
  const scrubDir = path.join(resolvedEvidence, "scrub");
  const framesDir = path.join(scrubDir, "frames");
  fs.mkdirSync(framesDir, { recursive: true });

  const clampedFrames = Math.max(8, Math.min(180, Number(frameCount) || 60));
  const ext = format === "png" ? "png" : "jpg";
  const vp = viewport === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 900 };

  const { browser } = await launchBrowser();
  try {
    const context = await browser.newContext({
      viewport: vp,
      deviceScaleFactor: 1,
      isMobile: viewport === "mobile",
    });
    const page = await context.newPage();

    if (deterministic) {
      await page.addInitScript(buildDeterministicClockInitScript(getEvidenceClock(resolvedEvidence, { create: true })));
    }

    let response;
    try {
      response = await page.goto(normalizedUrl, { waitUntil: "networkidle", timeout: timeoutMs });
    } catch {
      response = await page.goto(normalizedUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    }

    const blockCheck = await detectBlockedPage(page, response);
    if (blockCheck.blocked) {
      return { status: "blocked", ...blockCheck };
    }

    await scrollAndSettlePage(page, { waitMs: 500 });

    const docMetrics = await page.evaluate((sel) => {
      let targetRect = null;
      if (sel) {
        const el = document.querySelector(sel);
        if (el) {
          const r = el.getBoundingClientRect();
          targetRect = { width: Math.round(r.width), height: Math.round(r.height) };
        }
      }
      return {
        scrollHeight: document.documentElement.scrollHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        targetRect,
        title: document.title || "Scroll Scrub Experience",
      };
    }, selector);

    const maxScroll = Math.max(0, docMetrics.scrollHeight - docMetrics.viewportHeight);
    const framePaths = [];

    for (let i = 0; i < clampedFrames; i++) {
      const progress = clampedFrames === 1 ? 0 : i / (clampedFrames - 1);
      const targetY = Math.round(maxScroll * progress);

      await page.evaluate((y) => {
        window.scrollTo({ top: y, behavior: "instant" });
        window.dispatchEvent(new Event("scroll"));
      }, targetY);

      if (deterministic) {
        await lockDeterministicFrame(page, FIRST_LOCK_MS + i * 33.3334);
      } else {
        await page.waitForTimeout(settleMs);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      }

      const relName = `frames/frame-${String(i).padStart(4, "0")}.${ext}`;
      const absPath = path.join(scrubDir, relName);
      const shotOpts = {
        path: absPath,
        type: ext === "png" ? "png" : "jpeg",
        ...(ext === "jpg" ? { quality: Math.max(50, Math.min(100, quality)) } : {}),
      };

      if (selector) {
        const loc = page.locator(selector).first();
        if ((await loc.count()) > 0) {
          await loc.screenshot(shotOpts);
        } else {
          await page.screenshot({ ...shotOpts, fullPage: false });
        }
      } else {
        await page.screenshot({ ...shotOpts, fullPage: false });
      }

      framePaths.push(relName);
    }

    const frameWidth = docMetrics.targetRect?.width || vp.width;
    const frameHeight = docMetrics.targetRect?.height || vp.height;

    const manifest = {
      capturedAt: new Date().toISOString(),
      url: normalizedUrl,
      title: docMetrics.title,
      selector,
      deterministic,
      format: ext,
      frameCount: framePaths.length,
      frameWidth,
      frameHeight,
      scrollHeight: Math.max(docMetrics.scrollHeight, vp.height * 3),
      viewport: vp,
      frames: framePaths,
    };

    fs.writeFileSync(path.join(scrubDir, "scrub-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    writeScrollScrubPlayerFiles(scrubDir, manifest);

    return {
      status: "ok",
      url: normalizedUrl,
      scrubDir,
      manifestPath: path.join(scrubDir, "scrub-manifest.json"),
      playerScriptPath: path.join(scrubDir, "scroll-scrub-player.js"),
      demoHtmlPath: path.join(scrubDir, "demo.html"),
      frameCount: framePaths.length,
      frameWidth,
      frameHeight,
      scrollHeight: manifest.scrollHeight,
    };
  } finally {
    await browser.close();
  }
}

export function writeScrollScrubPlayerFiles(destDir, manifest, { framesPrefix = "./" } = {}) {
  const playerJs = `/**
 * Site-REA Apple-Style Scroll-Scrub Canvas Player
 * Smoothly scrubs pre-rendered 3D/WebGPU frames synced to scroll progress (0..1)
 * with HiDPI scaling, progressive preloading, and zero WebGPU compatibility overhead.
 */
export class ScrollScrubPlayer {
  constructor({ canvas, track, frames, frameWidth, frameHeight, smoothing = 0.16, onProgress = null }) {
    this.canvas = typeof canvas === "string" ? document.querySelector(canvas) : canvas;
    this.track = typeof track === "string" ? document.querySelector(track) : track;
    this.ctx = this.canvas.getContext("2d");
    this.frames = frames;
    this.frameWidth = frameWidth;
    this.frameHeight = frameHeight;
    this.smoothing = smoothing;
    this.onProgress = onProgress;

    this.images = new Array(frames.length);
    this.loadedCount = 0;
    this.currentFrame = 0;
    this.targetFrame = 0;
    this.lastDrawn = -1;
    this.rafId = null;

    this._onScroll = this._onScroll.bind(this);
    this._onResize = this._onResize.bind(this);
    this._tick = this._tick.bind(this);

    this._onResize();
    this._preload();
    window.addEventListener("scroll", this._onScroll, { passive: true });
    window.addEventListener("resize", this._onResize, { passive: true });
    this._onScroll();
    this.rafId = requestAnimationFrame(this._tick);
  }

  _preload() {
    this.frames.forEach((src, i) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        this.images[i] = img;
        this.loadedCount++;
        if (i === 0 || i === Math.round(this.currentFrame)) {
          this.lastDrawn = -1;
          this._drawFrame(Math.round(this.currentFrame));
        }
      };
      img.src = src;
    });
  }

  _onResize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round((rect.width || window.innerWidth) * dpr));
    const h = Math.max(1, Math.round((rect.height || window.innerHeight) * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.lastDrawn = -1;
    }
  }

  _onScroll() {
    let progress = 0;
    if (this.track) {
      const rect = this.track.getBoundingClientRect();
      const scrollable = Math.max(1, this.track.offsetHeight - window.innerHeight);
      progress = Math.min(1, Math.max(0, -rect.top / scrollable));
    } else {
      const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      progress = Math.min(1, Math.max(0, window.scrollY / scrollable));
    }
    this.targetFrame = progress * (this.frames.length - 1);
    if (typeof this.onProgress === "function") {
      this.onProgress(progress, Math.round(this.targetFrame));
    }
  }

  _drawFrame(index) {
    const clamped = Math.max(0, Math.min(this.frames.length - 1, index));
    let img = this.images[clamped];
    if (!img) {
      // Find nearest loaded frame so canvas never flashes blank
      for (let offset = 1; offset < this.frames.length; offset++) {
        if (this.images[clamped - offset]) { img = this.images[clamped - offset]; break; }
        if (this.images[clamped + offset]) { img = this.images[clamped + offset]; break; }
      }
    }
    if (!img) return;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const dx = (cw - dw) * 0.5;
    const dy = (ch - dh) * 0.5;
    this.ctx.clearRect(0, 0, cw, ch);
    this.ctx.drawImage(img, dx, dy, dw, dh);
    this.lastDrawn = clamped;
  }

  _tick() {
    const delta = this.targetFrame - this.currentFrame;
    if (Math.abs(delta) < 0.05) {
      this.currentFrame = this.targetFrame;
    } else {
      this.currentFrame += delta * this.smoothing;
    }
    const idx = Math.round(this.currentFrame);
    if (idx !== this.lastDrawn) {
      this._drawFrame(idx);
    }
    this.rafId = requestAnimationFrame(this._tick);
  }

  destroy() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    window.removeEventListener("scroll", this._onScroll);
    window.removeEventListener("resize", this._onResize);
  }
}
`;

  fs.writeFileSync(path.join(destDir, "scroll-scrub-player.js"), playerJs, "utf8");

  const resolvedFrames = (manifest.frames || []).map((f) => `${framesPrefix}${f}`);
  const demoHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${String(manifest.title || "Scroll Scrub Canvas").replace(/</g, "&lt;")}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #000; color: #fff; font-family: system-ui, sans-serif; }
    .scrub-track { position: relative; height: ${manifest.scrollHeight || 3600}px; }
    .scrub-sticky { position: sticky; top: 0; width: 100%; height: 100vh; overflow: hidden; }
    canvas#scrub-canvas { width: 100%; height: 100%; display: block; }
    .scrub-overlay { position: absolute; inset: 0; pointer-events: none; }
  </style>
</head>
<body>
  <main class="scrub-track" id="scrub-track">
    <div class="scrub-sticky">
      <canvas id="scrub-canvas"></canvas>
      <div class="scrub-overlay" id="scrub-overlay">
        <!-- Place clean editable HTML/CSS headings, nav, and CTA overlays here -->
      </div>
    </div>
  </main>
  <script type="module">
    import { ScrollScrubPlayer } from "./scroll-scrub-player.js";
    new ScrollScrubPlayer({
      canvas: "#scrub-canvas",
      track: "#scrub-track",
      frames: ${JSON.stringify(resolvedFrames)},
      frameWidth: ${manifest.frameWidth || 1440},
      frameHeight: ${manifest.frameHeight || 900},
      smoothing: 1.0
    });
  </script>
</body>
</html>
`;
  fs.writeFileSync(path.join(destDir, "demo.html"), demoHtml, "utf8");
}
