import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { launchBrowser, scrollAndSettlePage } from "./browser.mjs";
import { startStaticServer } from "./static-server.mjs";
import { buildDeterministicClockInitScript, lockDeterministicFrame, getEvidenceClock, FIRST_LOCK_MS } from "./deterministic-clock.mjs";
import { startBlackholeProxy, listenEphemeral, closeServer, gotoSettled } from "./mirror-harness.mjs";
import { attachExactReplay } from "./exact-replay.mjs";

function readPng(filePath) {
  return PNG.sync.read(fs.readFileSync(filePath));
}

function padPngTo(srcPng, targetW, targetH) {
  if (srcPng.width === targetW && srcPng.height === targetH) return srcPng;
  const out = new PNG({ width: targetW, height: targetH });
  // Fill neutral dark slate so padded area is clearly distinct
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 30;
    out.data[i + 1] = 32;
    out.data[i + 2] = 40;
    out.data[i + 3] = 255;
  }
  const copyW = Math.min(srcPng.width, targetW);
  const copyH = Math.min(srcPng.height, targetH);
  for (let y = 0; y < copyH; y++) {
    const srcStart = y * srcPng.width * 4;
    const dstStart = y * targetW * 4;
    srcPng.data.copy(out.data, dstStart, srcStart, srcStart + copyW * 4);
  }
  return out;
}

function comparePngFiles(originalPath, clonePath, compositeOutPath, { maxHeight = 12000 } = {}) {
  if (!fs.existsSync(originalPath) || !fs.existsSync(clonePath)) {
    return null;
  }
  const origRaw = readPng(originalPath);
  const cloneRaw = readPng(clonePath);

  const w = Math.max(origRaw.width, cloneRaw.width);
  const h = Math.min(maxHeight, Math.max(origRaw.height, cloneRaw.height));

  const orig = padPngTo(origRaw, w, h);
  const clone = padPngTo(cloneRaw, w, h);
  const diff = new PNG({ width: w, height: h });

  const diffPixels = pixelmatch(orig.data, clone.data, diff.data, w, h, {
    threshold: 0.14,
    includeAA: true,
    alpha: 0.25,
  });

  const totalPixels = w * h;
  const similarityPct = Number((((totalPixels - diffPixels) / totalPixels) * 100).toFixed(2));

  // Build 3-panel composite: Original | Diff Heatmap | Clone
  const gap = 8;
  const compW = w * 3 + gap * 2;
  const comp = new PNG({ width: compW, height: h });
  for (let i = 0; i < comp.data.length; i += 4) {
    comp.data[i] = 18;
    comp.data[i + 1] = 20;
    comp.data[i + 2] = 26;
    comp.data[i + 3] = 255;
  }

  const blit = (src, offsetX) => {
    for (let y = 0; y < h; y++) {
      const srcStart = y * w * 4;
      const dstStart = (y * compW + offsetX) * 4;
      src.data.copy(comp.data, dstStart, srcStart, srcStart + w * 4);
    }
  };

  blit(orig, 0);
  blit(diff, w + gap);
  blit(clone, (w + gap) * 2);

  fs.writeFileSync(compositeOutPath, PNG.sync.write(comp));

  return {
    originalDimensions: { width: origRaw.width, height: origRaw.height },
    cloneDimensions: { width: cloneRaw.width, height: cloneRaw.height },
    heightRatio: Number((cloneRaw.height / Math.max(1, origRaw.height)).toFixed(3)),
    diffPixels,
    totalPixels,
    similarityPct,
    compositeDiffPath: compositeOutPath,
  };
}

function cropBand(png, yStart, bandH) {
  const safeY = Math.max(0, Math.min(yStart, Math.max(0, png.height - 1)));
  const safeH = Math.max(1, Math.min(bandH, png.height - safeY));
  const out = new PNG({ width: png.width, height: safeH });
  for (let y = 0; y < safeH; y++) {
    const srcStart = (safeY + y) * png.width * 4;
    const dstStart = y * png.width * 4;
    png.data.copy(out.data, dstStart, srcStart, srcStart + png.width * 4);
  }
  return out;
}

function compareSectionBands(origFullPath, cloneFullPath, sectionsIndex) {
  if (!fs.existsSync(origFullPath) || !fs.existsSync(cloneFullPath) || !Array.isArray(sectionsIndex)) {
    return [];
  }
  const origPng = readPng(origFullPath);
  const clonePng = readPng(cloneFullPath);
  const results = [];

  for (const sec of sectionsIndex.slice(0, 25)) {
    const box = sec.boundingBox;
    if (!box || box.height < 20 || box.y >= origPng.height) continue;
    const bandH = Math.min(box.height, 2500, origPng.height - box.y);
    if (bandH < 10) continue;

    const origBand = cropBand(origPng, box.y, bandH);
    const cloneBand =
      box.y < clonePng.height
        ? padPngTo(cropBand(clonePng, box.y, Math.min(bandH, clonePng.height - box.y)), origBand.width, origBand.height)
        : padPngTo(new PNG({ width: 1, height: 1 }), origBand.width, origBand.height);

    const diff = new PNG({ width: origBand.width, height: origBand.height });
    const diffPixels = pixelmatch(origBand.data, cloneBand.data, diff.data, origBand.width, origBand.height, {
      threshold: 0.14,
      includeAA: true,
    });
    const total = origBand.width * origBand.height;
    const similarityPct = Number((((total - diffPixels) / total) * 100).toFixed(2));
    results.push({
      index: sec.index,
      role: sec.role,
      heading: sec.heading || null,
      y: box.y,
      height: bandH,
      similarityPct,
    });
  }
  return results;
}

/** Console text with addresses and numbers removed, so the same error matches across hosts. */
function normalizeConsoleText(text) {
  return String(text)
    .replace(/https?:\/\/[^\s)'"]+/g, "<url>")
    // HTTP/2 has no status text: "404 ()" on the live site, "404 (Not Found)" locally.
    .replace(/\([^)]*\)/g, "()")
    .replace(/\d+/g, "#")
    .trim();
}

const VIEWPORT_SIZES = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

/**
 * Loads one target in each viewport, screenshots it and compares against the
 * screenshots taken from the original site.
 */
async function verifyTarget({
  browser,
  label,
  targetUrl,
  outDir,
  resolvedEvidence,
  origManifest,
  viewports,
  useDeterministic,
  verifyScrollTimeline,
  waitMs,
  timeoutMs,
  contextOptions = {},
  prepareContext = null,
  ignoreConsole = null,
}) {
  const screenshotsDir = path.join(resolvedEvidence, "screenshots");
  fs.mkdirSync(outDir, { recursive: true });
  const results = {};
  const issues = [];
  const tag = (vp) => (label ? `[${label} ${vp}]` : `[${vp}]`);
  // Errors the original page logged too are not the clone's fault.
  const inherited = new Set(
    [...(origManifest?.consoleErrors || []), ...(origManifest?.pageErrors || [])].map(normalizeConsoleText)
  );

  for (const vpName of viewports) {
    const isMobile = vpName === "mobile";
    const vp = VIEWPORT_SIZES[vpName] || VIEWPORT_SIZES.desktop;
    const context = await browser.newContext({
      viewport: vp,
      deviceScaleFactor: 1,
      isMobile,
      hasTouch: isMobile,
      ...contextOptions,
    });
    if (prepareContext) await prepareContext(context);
    const page = await context.newPage();
    if (useDeterministic) {
      await page.addInitScript(buildDeterministicClockInitScript(getEvidenceClock(resolvedEvidence)));
    }

    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (ignoreConsole && ignoreConsole.test(text)) return;
      if (inherited.has(normalizeConsoleText(text.slice(0, 240)))) return;
      consoleErrors.push(text.slice(0, 240));
    });
    page.on("pageerror", (err) => {
      const text = String(err.message || err).slice(0, 240);
      if (inherited.has(normalizeConsoleText(text))) return;
      pageErrors.push(text);
    });
    page.on("requestfailed", (req) => {
      failedRequests.push({ url: req.url().slice(0, 180), reason: req.failure()?.errorText || "failed" });
    });

    await gotoSettled(page, targetUrl, { timeoutMs });
    await scrollAndSettlePage(page, { waitMs });
    if (useDeterministic) {
      await lockDeterministicFrame(page, FIRST_LOCK_MS);
    }

    const heroClonePath = path.join(outDir, `clone-${vpName}-hero.png`);
    const fullClonePath = path.join(outDir, `clone-${vpName}-full.png`);
    await page.screenshot({ path: heroClonePath, fullPage: false });

    const health = await page.evaluate(() => {
      const brokenImages = Array.from(document.images || [])
        .filter((img) => {
          const s = getComputedStyle(img);
          // Finished loading with no pixels = failed. An image that has not
          // loaded yet (loading="lazy" below the fold) is not broken.
          return (
            s.display !== "none" &&
            s.visibility !== "hidden" &&
            img.complete &&
            img.naturalWidth === 0 &&
            Boolean(img.currentSrc || img.getAttribute("src"))
          );
        })
        .map((img) => ({
          src: img.currentSrc || img.getAttribute("src") || "",
          alt: img.getAttribute("alt") || "",
        }));
      const horizontalOverflowPx = Math.max(
        0,
        document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight,
        horizontalOverflowPx,
        imageCount: document.images.length,
        brokenImages,
        loadedFonts: Array.from(document.fonts || [])
          .filter((f) => f.status === "loaded")
          .map((f) => f.family.replace(/['"]/g, "")),
      };
    });

    if (health.scrollHeight <= 20000) {
      await page.screenshot({ path: fullClonePath, fullPage: true });
    } else {
      await page.screenshot({
        path: fullClonePath,
        fullPage: true,
        clip: { x: 0, y: 0, width: vp.width, height: 20000 },
      });
    }

    // Scroll-stop comparison against the frames recorded from the original.
    let scrollTimelineDiffs = undefined;
    let dynamicSimilarityPct = undefined;
    const timelineJsonPath = path.join(resolvedEvidence, "scroll-timeline.json");
    const shouldVerifyTimeline =
      !isMobile && fs.existsSync(timelineJsonPath) && (verifyScrollTimeline === true || verifyScrollTimeline === "auto");

    if (shouldVerifyTimeline) {
      try {
        const origTimeline = JSON.parse(fs.readFileSync(timelineJsonPath, "utf8"));
        const origFrames = origTimeline.frames || [];
        const cloneMaxScroll = Math.max(0, health.scrollHeight - vp.height);
        const origMaxScroll = Math.max(0, ...origFrames.map((f) => Number(f.actualScrollY) || 0));
        // A faithful clone has the same height, so it is compared at the very
        // same pixel offsets. A rebuilt page of another height is compared by percentage.
        const sameHeight = origMaxScroll > 0 && Math.abs(cloneMaxScroll - origMaxScroll) / origMaxScroll < 0.02;
        const diffs = [];

        for (let fIdx = 0; fIdx < origFrames.length; fIdx++) {
          const frame = origFrames[fIdx];
          if (!frame.screenshot || !fs.existsSync(frame.screenshot)) continue;
          const targetY =
            sameHeight && Number.isFinite(frame.actualScrollY)
              ? Math.min(frame.actualScrollY, cloneMaxScroll)
              : Math.round(cloneMaxScroll * (frame.pct / 100));
          await page.evaluate((y) => {
            window.scrollTo({ top: y, behavior: "instant" });
            window.dispatchEvent(new Event("scroll"));
          }, targetY);
          if (useDeterministic) {
            const targetT = frame.virtualTimeMs ?? FIRST_LOCK_MS + fIdx * 500;
            await lockDeterministicFrame(page, targetT);
          } else {
            await page.waitForTimeout(220);
            await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
          }

          const pctTag = String(frame.pct).padStart(3, "0");
          const cloneFramePath = path.join(outDir, `clone-scroll-${pctTag}.png`);
          await page.screenshot({ path: cloneFramePath, fullPage: false });
          const fDiff = comparePngFiles(frame.screenshot, cloneFramePath, path.join(outDir, `compare-scroll-${pctTag}.png`));
          if (fDiff) {
            diffs.push({
              pct: frame.pct,
              origScrollY: frame.actualScrollY,
              cloneScrollY: targetY,
              similarityPct: fDiff.similarityPct,
              compositeDiffPath: fDiff.compositeDiffPath,
            });
          }
        }

        if (diffs.length > 0) {
          scrollTimelineDiffs = diffs;
          dynamicSimilarityPct = Number((diffs.reduce((acc, d) => acc + d.similarityPct, 0) / diffs.length).toFixed(2));
          const worst = [...diffs].sort((a, b) => a.similarityPct - b.similarityPct)[0];
          if (worst && worst.similarityPct < 90) {
            issues.push(
              `${tag(vpName)} scroll stop ${worst.pct}% similarity is ${worst.similarityPct}% (avg ${dynamicSimilarityPct}%) — inspect ${worst.compositeDiffPath}.`
            );
          }
        }
      } catch (err) {
        issues.push(`${tag(vpName)} scroll-timeline verification skipped: ${err.message}`);
      }
    }

    await context.close();

    const origHeroPath = path.join(screenshotsDir, `${vpName}-hero.png`);
    const origFullPath = path.join(screenshotsDir, `${vpName}-full.png`);
    const heroDiff = comparePngFiles(origHeroPath, heroClonePath, path.join(outDir, `compare-${vpName}-hero.png`));
    const fullDiff = comparePngFiles(origFullPath, fullClonePath, path.join(outDir, `compare-${vpName}-full.png`), {
      maxHeight: 12000,
    });

    let sectionDiffs = undefined;
    if (!isMobile && origManifest?.sectionsIndex) {
      try {
        sectionDiffs = compareSectionBands(origFullPath, fullClonePath, origManifest.sectionsIndex);
      } catch {}
    }

    if (consoleErrors.length > 0) {
      issues.push(`${tag(vpName)} ${consoleErrors.length} console error(s): ${consoleErrors[0]}`);
    }
    if (pageErrors.length > 0) {
      issues.push(`${tag(vpName)} ${pageErrors.length} uncaught page error(s): ${pageErrors[0]}`);
    }
    if (health.brokenImages.length > 0) {
      issues.push(
        `${tag(vpName)} ${health.brokenImages.length} broken image(s): ${health.brokenImages
          .slice(0, 3)
          .map((b) => b.src)
          .join(", ")}`
      );
    }
    if (health.horizontalOverflowPx > 4) {
      issues.push(`${tag(vpName)} horizontal overflow (${health.horizontalOverflowPx}px wider than viewport).`);
    }
    if (heroDiff && heroDiff.similarityPct < 75) {
      issues.push(
        `${tag(vpName)} hero visual similarity is ${heroDiff.similarityPct}% — inspect ${heroDiff.compositeDiffPath} (Original | Diff | Clone).`
      );
    }
    if (fullDiff && (fullDiff.heightRatio < 0.75 || fullDiff.heightRatio > 1.35)) {
      issues.push(
        `${tag(vpName)} full-page height ratio is ${fullDiff.heightRatio}x vs original (${fullDiff.cloneDimensions.height}px vs ${fullDiff.originalDimensions.height}px).`
      );
    }

    results[vpName] = {
      health: {
        ...health,
        loadedFonts: Array.from(new Set(health.loadedFonts)).slice(0, 12),
        consoleErrorsCount: consoleErrors.length,
        consoleErrors: consoleErrors.slice(0, 10),
        pageErrors: pageErrors.slice(0, 10),
        failedRequests: failedRequests.slice(0, 10),
      },
      screenshots: { cloneHero: heroClonePath, cloneFull: fullClonePath },
      heroDiff,
      fullDiff,
      ...(sectionDiffs ? { sectionDiffs } : {}),
      ...(scrollTimelineDiffs ? { dynamicSimilarityPct, scrollTimelineDiffs } : {}),
    };
  }

  const healthy = Object.values(results).every(
    (r) =>
      r.health.consoleErrorsCount === 0 &&
      r.health.pageErrors.length === 0 &&
      r.health.brokenImages.length === 0 &&
      r.health.horizontalOverflowPx <= 4
  );
  return { results, issues, healthy };
}

function summarizeReplayReport(mr) {
  return {
    responsesServed: mr.served,
    cacheMisses: mr.misses.length,
    misses: mr.misses.slice(0, 25),
    fuzzyMatches: mr.fuzzy.length,
    trackersStubbed: mr.trackersStubbed,
    blockedLiveConnections: (mr.blockedLiveConnections || (mr.clientLogs || []).filter((l) => l.kind === "websocket-blocked").map((l) => l.detail)).slice(0, 10),
  };
}

/**
 * Compares a clone with the screenshots taken from the original site.
 *
 * Anything served from a local directory is verified with the internet cut
 * off. A runtime mirror is checked two ways:
 *   exact    – the recording answers at the network layer under the real URL
 *              (what `site-rea open` shows); nothing in the page can tell.
 *   portable – the project's own server.mjs on 127.0.0.1, usable in any browser.
 */
export async function verifyClone({
  evidenceDir,
  cloneUrl,
  cloneDir,
  viewports = ["desktop", "mobile"],
  verifyScrollTimeline = "auto",
  deterministic = "auto",
  replay = "auto",
  waitMs = 900,
  timeoutMs = 30000,
}) {
  const resolvedEvidence = path.resolve(evidenceDir);
  const verifyDir = path.join(resolvedEvidence, "verify");
  fs.mkdirSync(verifyDir, { recursive: true });

  let origManifest = null;
  const manifestPath = path.join(resolvedEvidence, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    try {
      origManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {}
  }
  const useDeterministic = deterministic === true || (deterministic === "auto" && Boolean(origManifest?.deterministic));

  if (!cloneUrl && !cloneDir) {
    throw new Error("Either clone_url or clone_dir must be provided.");
  }

  const resolvedClone = cloneDir ? path.resolve(cloneDir) : null;
  const isRuntimeMirror =
    !cloneUrl &&
    resolvedClone &&
    fs.existsSync(path.join(resolvedClone, "server.mjs")) &&
    fs.existsSync(path.join(resolvedClone, "runtime-cache", "index.json"));

  const { browser } = await launchBrowser();
  const common = { browser, resolvedEvidence, origManifest, viewports, useDeterministic, verifyScrollTimeline, waitMs, timeoutMs };
  const report = {
    status: "ok",
    verifiedAt: new Date().toISOString(),
    deterministic: useDeterministic,
    targetUrl: cloneUrl || null,
    offline: { enforced: false },
    results: {},
    issues: [],
  };
  const cleanups = [];

  try {
    if (isRuntimeMirror) {
      const cacheDir = path.join(resolvedClone, "runtime-cache");
      const wantExact = replay === "auto" || replay === "exact" || replay === "both";
      const wantPortable = replay === "auto" || replay === "portable" || replay === "both";
      report.replayModes = {};

      if (wantExact) {
        const blackhole = await startBlackholeProxy();
        cleanups.push(() => blackhole.close());
        let replayHandle = null;
        const pageUrl = JSON.parse(fs.readFileSync(path.join(cacheDir, "index.json"), "utf8")).pageUrl;
        const run = await verifyTarget({
          ...common,
          label: "exact",
          targetUrl: pageUrl,
          outDir: path.join(verifyDir, "exact"),
          contextOptions: { proxy: blackhole.proxy, serviceWorkers: "block", ignoreHTTPSErrors: true },
          // The favicon and connection warm-ups are fetched by the browser itself,
          // outside the replay; with no network they fail with this message.
          ignoreConsole: /ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED/,
          prepareContext: async (context) => {
            replayHandle = await attachExactReplay(context, cacheDir, { mode: "offline", shared: replayHandle });
          },
        });
        const summary = summarizeReplayReport(replayHandle.report);
        // Every HTTP(S) request is answered by the replay, so what reaches the
        // proxy can only be a connection warm-up (preconnect) or a non-HTTP channel.
        const connectionAttempts = Array.from(new Set(blackhole.attempts));
        const passed = summary.cacheMisses === 0;
        if (!passed) {
          run.issues.push(
            `[exact] ${summary.cacheMisses} request(s) had no recorded response, e.g. ${summary.misses[0].method} ${summary.misses[0].url}.`
          );
        }
        report.replayModes.exact = {
          targetUrl: pageUrl,
          offline: { enforced: true, passed, ...summary, connectionWarmupsBlocked: connectionAttempts.slice(0, 15) },
          healthy: run.healthy,
          results: run.results,
          issues: run.issues,
        };
      }

      if (wantPortable) {
        const blackhole = await startBlackholeProxy();
        cleanups.push(() => blackhole.close());
        // Boot the project's own server.mjs: the artifact the user will actually run.
        const mod = await import(pathToFileURL(path.join(resolvedClone, "server.mjs")).href + `?t=${Date.now()}`);
        const mirrorServer = mod.createRuntimeMirrorServer({ cacheDir, mode: "offline" });
        const base = await listenEphemeral(mirrorServer);
        cleanups.push(() => closeServer(mirrorServer));
        const recordedPage = new URL(mirrorServer.siteRea.cache.index.pageUrl);
        const targetUrl = base + recordedPage.pathname + recordedPage.search;
        const run = await verifyTarget({
          ...common,
          label: "portable",
          targetUrl,
          outDir: path.join(verifyDir, "portable"),
          contextOptions: { proxy: blackhole.proxy },
        });
        const summary = summarizeReplayReport(mirrorServer.siteRea.report);
        const external = Array.from(new Set(blackhole.attempts));
        const passed = summary.cacheMisses === 0 && external.length === 0;
        if (summary.cacheMisses > 0) {
          run.issues.push(
            `[portable] ${summary.cacheMisses} request(s) had no recorded response, e.g. ${summary.misses[0].method} ${summary.misses[0].url}.`
          );
        }
        if (external.length > 0) {
          run.issues.push(
            `[portable] the page tried to reach the internet ${external.length} time(s), e.g. ${external[0]} (cross-origin frames and connection hints are not covered by the local server).`
          );
        }
        report.replayModes.portable = {
          targetUrl,
          offline: { enforced: true, passed, ...summary, externalRequestsBlocked: external.length, externalRequests: external.slice(0, 25) },
          healthy: run.healthy,
          results: run.results,
          issues: run.issues,
        };
      }

      const primaryName = report.replayModes.exact ? "exact" : "portable";
      const primary = report.replayModes[primaryName];
      report.primaryMode = primaryName;
      report.targetUrl = primary.targetUrl;
      report.offline = primary.offline;
      report.results = primary.results;
      report.issues = Object.values(report.replayModes).flatMap((m) => m.issues);
      report.passedHealthChecks = primary.healthy && primary.offline.passed;
      if (report.replayModes.portable) {
        report.portablePassedHealthChecks = report.replayModes.portable.healthy && report.replayModes.portable.offline.passed;
      }
    } else {
      let targetUrl = cloneUrl;
      if (!targetUrl) {
        const staticServer = await startStaticServer(resolvedClone, { port: 0 });
        cleanups.push(() => staticServer.close());
        targetUrl = staticServer.url;
      }
      // A clone served locally must not need the internet: its browser gets
      // no route out and every attempt to find one is counted.
      const enforceOffline = Boolean(cloneDir) || /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(String(targetUrl));
      const blackhole = enforceOffline ? await startBlackholeProxy() : null;
      if (blackhole) cleanups.push(() => blackhole.close());

      const run = await verifyTarget({
        ...common,
        label: "",
        targetUrl,
        outDir: verifyDir,
        contextOptions: blackhole ? { proxy: blackhole.proxy } : {},
      });
      report.targetUrl = targetUrl;
      report.results = run.results;
      report.issues = run.issues;
      report.offline = { enforced: enforceOffline, passed: true };
      if (blackhole) {
        const external = Array.from(new Set(blackhole.attempts));
        report.offline.externalRequestsBlocked = external.length;
        report.offline.externalRequests = external.slice(0, 25);
        report.offline.passed = external.length === 0;
        if (external.length > 0) {
          report.issues.push(
            `[offline] the clone tried to reach the internet ${external.length} time(s), e.g. ${external[0]} — these resources are not local.`
          );
        }
      }
      report.passedHealthChecks = run.healthy && report.offline.passed;
    }

    fs.writeFileSync(path.join(verifyDir, "verify-report.json"), JSON.stringify(report, null, 2), "utf8");
    return report;
  } finally {
    await browser.close();
    for (const fn of cleanups.reverse()) {
      await fn().catch?.(() => {});
    }
  }
}
