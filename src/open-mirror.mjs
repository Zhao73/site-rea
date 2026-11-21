import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { resolveChromeExecutable } from "./browser.mjs";
import { attachExactReplay } from "./exact-replay.mjs";
import { startBlackholeProxy } from "./mirror-harness.mjs";

function findCacheDir(dir) {
  const resolved = path.resolve(dir);
  for (const candidate of [
    path.join(resolved, "runtime-cache"),
    path.join(resolved, ".site-rea", "runtime-cache"),
    resolved,
  ]) {
    if (fs.existsSync(path.join(candidate, "index.json"))) return candidate;
  }
  throw new Error(`No runtime-cache/index.json found in ${resolved}. Capture the site first (capture_runtime: true).`);
}

/**
 * Opens a recording in a browser window under its real address. The browser
 * has no route to the internet; every request is answered from runtime-cache,
 * so cookies, origins and host checks behave exactly as on the live site.
 */
export async function openMirror({ dir, headless = false, onReady = null } = {}) {
  const cacheDir = findCacheDir(dir);
  const executablePath = resolveChromeExecutable();
  if (!executablePath) {
    throw new Error("No Chromium or Chrome executable found. Run `npx playwright install chromium` or set SITE_REA_CHROME_PATH.");
  }
  const blackhole = await startBlackholeProxy();
  const browser = await chromium.launch({
    executablePath,
    headless,
    args: [
      "--enable-unsafe-webgpu",
      ...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
      // A fresh profile has no remembered window: give it a usable size and place.
      ...(headless ? [] : ["--window-size=1440,900", "--window-position=80,60"]),
    ],
  });
  const context = await browser.newContext({
    viewport: headless ? { width: 1440, height: 900 } : null,
    proxy: blackhole.proxy,
    serviceWorkers: "block",
    ignoreHTTPSErrors: true,
  });
  const replay = await attachExactReplay(context, cacheDir, { mode: "offline" });
  const page = await context.newPage();
  await page.goto(replay.pageUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
  if (!headless) await page.bringToFront().catch(() => {});

  const closed = new Promise((resolve) => browser.on("disconnected", resolve));
  const close = async () => {
    await browser.close().catch(() => {});
    await blackhole.close();
  };
  if (onReady) await onReady({ page, replay, close });
  return { pageUrl: replay.pageUrl, report: replay.report, closed: closed.then(() => blackhole.close()), close };
}
