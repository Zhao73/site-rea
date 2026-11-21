import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright-core";

const CHROME_CANDIDATES = [
  process.env.SITE_REA_CHROME_PATH,
  // macOS
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  // Linux
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  // Windows
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

function findPlaywrightCachedChromium() {
  const cacheRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
    path.join(os.homedir(), ".cache", "ms-playwright"),
    path.join(os.homedir(), "AppData", "Local", "ms-playwright"),
  ].filter(Boolean);

  for (const root of cacheRoots) {
    if (!fs.existsSync(root)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(root).sort().reverse();
    } catch {
      continue;
    }
    // Prefer full chromium over headless shell, newest revision first
    const ordered = [
      ...entries.filter((e) => /^chromium-\d+/.test(e)),
      ...entries.filter((e) => /^chromium_headless_shell-\d+/.test(e)),
    ];
    for (const dir of ordered) {
      const base = path.join(root, dir);
      const subCandidates = [
        path.join(base, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        path.join(base, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
        path.join(base, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
        path.join(base, "chrome-headless-shell-mac-x64", "chrome-headless-shell"),
        path.join(base, "chrome-linux", "chrome"),
        path.join(base, "chrome-headless-shell-linux64", "chrome-headless-shell"),
        path.join(base, "chrome-win", "chrome.exe"),
      ];
      for (const candidate of subCandidates) {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }
  return null;
}

/**
 * A dedicated testing browser comes first: driving the user's everyday Chrome
 * binary, even headless with a throwaway profile, can disturb the copy they
 * have open. The installed browsers are only a fallback.
 */
export function resolveChromeExecutable() {
  if (process.env.SITE_REA_CHROME_PATH && fs.existsSync(process.env.SITE_REA_CHROME_PATH)) {
    return process.env.SITE_REA_CHROME_PATH;
  }
  const dedicated = findPlaywrightCachedChromium();
  if (dedicated) return dedicated;
  for (const candidate of CHROME_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function launchBrowser({ enableGpu = true } = {}) {
  const executablePath = resolveChromeExecutable();
  if (!executablePath) {
    throw new Error(
      "No Chromium or Chrome executable found. Install Google Chrome or run `npx playwright install chromium`, or set SITE_REA_CHROME_PATH."
    );
  }
  const isHeadlessShell = path.basename(executablePath).includes("headless-shell");
  const baseArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--font-render-hinting=none",
  ];

  if (enableGpu && !isHeadlessShell) {
    const gpuArgs = [
      "--headless=new",
      "--enable-unsafe-webgpu",
      ...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
      ...baseArgs,
    ];
    try {
      const browser = await chromium.launch({
        executablePath,
        headless: true,
        args: gpuArgs,
      });
      return { browser, executablePath, gpuEnabled: true };
    } catch {
      // Fall back cleanly if host lacks GPU acceleration (e.g., headless CI container)
    }
  }

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-gpu", ...baseArgs],
  });
  return { browser, executablePath, gpuEnabled: false };
}

export async function detectBlockedPage(page, response) {
  const status = response ? response.status() : null;
  const info = await page.evaluate(() => {
    const title = (document.title || "").trim();
    const text = (document.body?.innerText || "").slice(0, 4000);
    const lowerTitle = title.toLowerCase();
    const lowerText = text.toLowerCase();
    const html = document.documentElement?.innerHTML?.slice(0, 15000) || "";

    const hasTurnstile =
      Boolean(document.querySelector("iframe[src*='challenges.cloudflare.com'], .cf-turnstile, #challenge-running, #challenge-stage")) ||
      lowerTitle.includes("just a moment") ||
      lowerText.includes("verify you are human") ||
      lowerText.includes("checking your browser before accessing");

    const hasRecaptcha =
      Boolean(document.querySelector(".g-recaptcha, iframe[src*='recaptcha/api2/anchor'], #captcha-form")) &&
      text.length < 1500;

    const hasHcaptcha =
      Boolean(document.querySelector(".h-captcha, iframe[src*='hcaptcha.com']")) &&
      text.length < 1500;

    const hasDataDomeOrPerimeterX =
      html.includes("geo.captcha-delivery.com") ||
      Boolean(document.querySelector("#px-captcha")) ||
      lowerText.includes("press & hold to confirm you are a human");

    const isEmptyBody = (document.body?.innerText || "").trim().length < 20 && document.querySelectorAll("img, svg, canvas, video").length === 0;

    return {
      title,
      url: location.href,
      textLength: text.length,
      hasTurnstile,
      hasRecaptcha,
      hasHcaptcha,
      hasDataDomeOrPerimeterX,
      isEmptyBody,
    };
  });

  if (info.hasTurnstile || info.hasRecaptcha || info.hasHcaptcha || info.hasDataDomeOrPerimeterX) {
    return {
      blocked: true,
      code: "captcha_or_bot_challenge",
      httpStatus: status,
      title: info.title,
      finalUrl: info.url,
      reason:
        "Target page presented a CAPTCHA or anti-bot verification challenge. Site-REA does not bypass bot checks; ask the user to open/save the page locally or supply a local HTML/HAR export.",
    };
  }

  if (status && status >= 400 && info.textLength < 1200) {
    return {
      blocked: true,
      code: status === 401 || status === 403 ? "access_denied" : "http_error",
      httpStatus: status,
      title: info.title,
      finalUrl: info.url,
      reason: `Target returned HTTP ${status} (${info.title || "no title"}).`,
    };
  }

  return { blocked: false, httpStatus: status, title: info.title, finalUrl: info.url };
}

export async function scrollAndSettlePage(page, { waitMs = 1200, maxScrollHeight = 24000 } = {}) {
  // Smooth step-scroll down the page to trigger lazy images & IntersectionObserver animations
  await page.evaluate(async (maxH) => {
    // The page's own setTimeout may be virtualised (deterministic mode holds slow timers).
    const setTimeout = (window.__SITE_REA_CLOCK__ && window.__SITE_REA_CLOCK__.realSetTimeout) || window.setTimeout;
    const step = Math.max(350, Math.floor(window.innerHeight * 0.75));
    const total = Math.min(document.documentElement.scrollHeight, maxH);
    for (let y = 0; y <= total; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 110));
    }
    window.scrollTo(0, 0);
  }, maxScrollHeight);

  // Wait for fonts and visible images to finish loading
  await page.evaluate(async () => {
    const setTimeout = (window.__SITE_REA_CLOCK__ && window.__SITE_REA_CLOCK__.realSetTimeout) || window.setTimeout;
    try {
      await document.fonts?.ready;
    } catch {}
    const imgs = Array.from(document.images || []).slice(0, 120);
    await Promise.allSettled(
      imgs.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          const timer = setTimeout(resolve, 2500);
          img.addEventListener("load", () => { clearTimeout(timer); resolve(); }, { once: true });
          img.addEventListener("error", () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      })
    );
  });

  if (waitMs > 0) {
    await page.waitForTimeout(waitMs);
  }
}

export function attachResourceCollector(page, { maxBytesPerFile = 25 * 1024 * 1024, maxFiles = 350 } = {}) {
  const resources = new Map();
  const pending = new Set();
  const RICH_MEDIA_EXT_RE = /\.(glb|gltf|bin|hdr|exr|ktx2|dds|basis|drc|obj|mtl|fbx|stl|ply|usdz|splat|spz|splinecode|lottie|wasm|wgsl|glsl|vert|frag|mp4|webm|woff2?|ttf|otf|svg|png|jpe?g|webp|avif|gif|ico)(\?|$)/i;

  const onResponse = (response) => {
    try {
      if (resources.size >= maxFiles) return;
      const status = response.status();
      if (status < 200 || status >= 300) return;
      const url = response.url();
      if (!url || !url.startsWith("http") || resources.has(url)) return;
      const headers = response.headers();
      const ct = (headers["content-type"] || "").toLowerCase();
      const reqType = response.request().resourceType();
      const isPotentialLottieJson =
        (ct.includes("application/json") || /\.json(\?|$)/i.test(url)) &&
        /lottie|anim|bodymovin|motion/i.test(url);

      const isInteresting =
        reqType === "image" ||
        reqType === "font" ||
        reqType === "stylesheet" ||
        reqType === "media" ||
        ct.startsWith("image/") ||
        ct.startsWith("font/") ||
        ct.startsWith("model/") ||
        ct.startsWith("video/") ||
        ct.includes("woff") ||
        ct.includes("text/css") ||
        ct.includes("gltf") ||
        ct.includes("wasm") ||
        RICH_MEDIA_EXT_RE.test(url) ||
        isPotentialLottieJson;
      if (!isInteresting) return;

      const contentLength = Number(headers["content-length"] || "0");
      if (contentLength > maxBytesPerFile) return;

      const task = response
        .body()
        .then((buf) => {
          if (buf && buf.length > 0 && buf.length <= maxBytesPerFile) {
            let finalType = reqType;
            // Verify Lottie JSON schema when capturing JSON files
            if (isPotentialLottieJson) {
              try {
                const parsed = JSON.parse(buf.toString("utf8"));
                if (parsed && typeof parsed === "object" && Array.isArray(parsed.layers) && parsed.fr) {
                  finalType = "lottie";
                } else {
                  return;
                }
              } catch {
                return;
              }
            }
            resources.set(url, {
              url,
              contentType: ct,
              resourceType: finalType,
              buffer: buf,
            });
          }
        })
        .catch(() => {})
        .finally(() => pending.delete(task));
      pending.add(task);
    } catch {}
  };

  page.on("response", onResponse);
  return {
    resources,
    async flush() {
      page.off("response", onResponse);
      await Promise.allSettled(Array.from(pending));
      return resources;
    },
  };
}

export async function dismissSoftOverlays(page) {
  // Non-destructive: only note whether a cookie banner exists; never bypass paywalls or auth gates.
  return await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("[role='dialog'], [class*='cookie'], [id*='cookie'], [class*='consent'], [id*='consent']"));
    return candidates
      .filter((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== "none" && s.visibility !== "hidden" && r.width > 100 && r.height > 40;
      })
      .slice(0, 5)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        className: typeof el.className === "string" ? el.className.slice(0, 120) : null,
        textPreview: (el.innerText || "").trim().slice(0, 140),
      }));
  });
}
