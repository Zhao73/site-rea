import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  launchBrowser,
  detectBlockedPage,
  scrollAndSettlePage,
  dismissSoftOverlays,
  attachResourceCollector,
} from "./browser.mjs";
import {
  extractDesignTokens,
  extractBlueprintAndAssets,
  extractFrozenMirror,
} from "./extractor.mjs";
import {
  downloadAndSaveAssets,
  rewriteBlueprintWithLocalAssets,
  buildOfflineMirror,
} from "./assets.mjs";
import {
  WEBGL_MOTION_INIT_SCRIPT,
  extractMotionAndWebglRuntime,
  persistWebglAndMotionEvidence,
  sampleScrollTimelineOnPage,
} from "./webgl-motion.mjs";
import {
  attachApiContractCollector,
  saveApiContracts,
} from "./api-mock.mjs";
import {
  buildDeterministicClockInitScript,
  lockDeterministicFrame,
  getEvidenceClock,
  FIRST_LOCK_MS,
} from "./deterministic-clock.mjs";
import {
  harRecordingPath,
  buildRuntimeCache,
  rehearseRuntimeMirror,
  DESKTOP_UA,
  MOBILE_UA,
} from "./runtime-mirror.mjs";
import { exercisePage } from "./mirror-harness.mjs";
import { cropSectionScreenshots } from "./section-shots.mjs";

export function slugFromUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.replace(/^www\./, "");
    const p = u.pathname.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 30);
    return `${host}${p ? "-" + p : ""}`.toLowerCase().replace(/[^a-z0-9.-]/g, "-");
  } catch {
    return "site-capture";
  }
}

export function defaultEvidenceDir(urlStr) {
  const slug = slugFromUrl(urlStr);
  return path.join(os.homedir(), ".gemini", "antigravity", "scratch", `site-rea-${slug}`, ".site-rea");
}

export async function captureSite({
  url,
  outputDir,
  downloadAssets = true,
  captureMirror = true,
  captureRuntime = true,
  rehearse = true,
  captureMobile = true,
  captureTimeline = "auto",
  timelineSteps = 9,
  deterministic = false,
  waitMs = 1200,
  maxSections = 25,
  timeoutMs = 45000,
} = {}) {
  if (!url) throw new Error("url is required");
  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  const evidenceDir = path.resolve(outputDir || defaultEvidenceDir(normalizedUrl));
  const screenshotsDir = path.join(evidenceDir, "screenshots");
  const sectionsDir = path.join(screenshotsDir, "sections");
  fs.mkdirSync(sectionsDir, { recursive: true });
  // A new capture starts a new clock: its epoch is this moment.
  fs.rmSync(path.join(evidenceDir, "clock.json"), { force: true });
  const clock = getEvidenceClock(evidenceDir, { create: true });

  const { browser, executablePath } = await launchBrowser();
  const warnings = [];
  const consoleErrors = [];
  const pageErrors = [];

  try {
    // 1. Desktop capture (1440 x 900)
    // The recording must see every request, so the site's own service worker
    // (which would answer from its private cache) is kept out of the way.
    const harPaths = [];
    const recordOptions = (name) => {
      if (!captureRuntime) return {};
      const harPath = harRecordingPath(evidenceDir, name);
      harPaths.push(harPath);
      return { recordHar: { path: harPath, content: "attach", mode: "full" }, serviceWorkers: "block" };
    };
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      userAgent: DESKTOP_UA,
      ...recordOptions("desktop"),
    });
    const page = await context.newPage();
    if (deterministic) {
      await page.addInitScript(buildDeterministicClockInitScript(clock));
    }
    await page.addInitScript(WEBGL_MOTION_INIT_SCRIPT);
    const collector = attachResourceCollector(page);
    const apiCollector = attachApiContractCollector(page);
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 240));
    });
    page.on("pageerror", (err) => pageErrors.push(String(err.message || err).slice(0, 240)));

    let response;
    try {
      response = await page.goto(normalizedUrl, { waitUntil: "networkidle", timeout: timeoutMs });
    } catch {
      warnings.push("networkidle timed out; fell back to domcontentloaded + settle");
      response = await page.goto(normalizedUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    }

    await page.waitForTimeout(Math.min(waitMs, 1500));

    // Check for CAPTCHA / bot challenge / hard access block
    const blockCheck = await detectBlockedPage(page, response);
    if (blockCheck.blocked) {
      const blockedShot = path.join(screenshotsDir, "blocked.png");
      await page.screenshot({ path: blockedShot }).catch(() => {});
      return {
        status: "blocked",
        ...blockCheck,
        evidenceDir,
        screenshot: blockedShot,
      };
    }

    // Trigger lazy loads & scroll animations
    await scrollAndSettlePage(page, { waitMs });
    if (deterministic) {
      await lockDeterministicFrame(page, FIRST_LOCK_MS);
    }
    const detectedOverlays = await dismissSoftOverlays(page);
    if (detectedOverlays.length > 0) {
      warnings.push(`Detected ${detectedOverlays.length} visible overlay/consent element(s).`);
    }

    // Hero screenshot (1440x900)
    const desktopHeroPath = path.join(screenshotsDir, "desktop-hero.png");
    await page.screenshot({ path: desktopHeroPath, fullPage: false });

    // Extract design tokens + blueprint + assets + WebGL/motion runtime
    const designTokens = await extractDesignTokens(page);
    const blueprintData = await extractBlueprintAndAssets(page, { maxSections });
    const runtimeMotionData = await extractMotionAndWebglRuntime(page);
    const richMedia = persistWebglAndMotionEvidence(evidenceDir, runtimeMotionData);

    // Full-page desktop screenshot (capped cleanly at 20000px height)
    const desktopFullPath = path.join(screenshotsDir, "desktop-full.png");
    const docW = Math.min(1440, Math.max(1, blueprintData.documentSize.viewportWidth || 1440));
    const docH = Math.min(20000, Math.max(900, blueprintData.documentSize.scrollHeight || 900));
    if (blueprintData.documentSize.scrollHeight <= 20000) {
      await page.screenshot({ path: desktopFullPath, fullPage: true });
    } else {
      warnings.push(`Page height ${blueprintData.documentSize.scrollHeight}px exceeded 20000px; clipped full screenshot.`);
      await page.screenshot({ path: desktopFullPath, fullPage: true, clip: { x: 0, y: 0, width: docW, height: docH } });
    }

    // Per-section screenshots are cut out of the full-page image: one render,
    // so every section lines up with the picture used for verification.
    warnings.push(...cropSectionScreenshots({ fullPagePath: desktopFullPath, sections: blueprintData.sections, sectionsDir }));

    // Extract frozen offline mirror payload while page is live
    const mirrorPayload = captureMirror ? await extractFrozenMirror(page) : null;

    // Auto-capture scroll timeline when requested OR when 3D/WebGL/WebGPU/parallax/sticky choreography is detected
    const hasRichMotion =
      richMedia.webgl.shaderCount > 0 ||
      (richMedia.webgpu?.shaderCount || 0) > 0 ||
      Boolean(richMedia.threeScene) ||
      richMedia.canvases.length > 0 ||
      richMedia.scrollTriggers.length > 0 ||
      richMedia.stickyElements.length > 0 ||
      richMedia.engines.some((e) =>
        ["three.js", "three-webgpu", "webgpu", "react-three-fiber", "gsap", "gsap-scrolltrigger", "lenis-smooth-scroll", "spline-3d", "lottie", "framer-motion"].includes(
          e.name
        )
      );
    const shouldSampleTimeline = captureTimeline === true || (captureTimeline === "auto" && hasRichMotion);
    let scrollTimeline = null;
    if (shouldSampleTimeline) {
      scrollTimeline = await sampleScrollTimelineOnPage(page, evidenceDir, {
        steps: timelineSteps,
        settleMs: 220,
        deterministic,
      });
    }

    // Everything that describes the page is saved; now walk it like a visitor so
    // lazily loaded chunks, menus and media end up in the recording too.
    if (captureRuntime) {
      await page
        .evaluate(() => {
          // Frames queued while the clock was frozen never reached the browser; release them.
          const clock = window.__SITE_REA_CLOCK__;
          if (clock) {
            clock.setFrozen(false);
            clock.step(1);
          }
        })
        .catch(() => {});
      await exercisePage(page, { waitMs: Math.min(waitMs, 900) }).catch(() => {});
    }

    const capturedResources = await collector.flush();
    const apiContracts = await apiCollector.flush();
    const apiContractsPath = saveApiContracts(evidenceDir, apiContracts);
    await context.close();

    // 2. Mobile capture (390 x 844)
    let mobileHeroPath = null;
    let mobileFullPath = null;
    let mobileMetrics = null;

    if (captureMobile) {
      const mobileCtx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        userAgent: MOBILE_UA,
        ...recordOptions("mobile"),
      });
      const mPage = await mobileCtx.newPage();
      if (deterministic) await mPage.addInitScript(buildDeterministicClockInitScript(clock));
      mPage.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 240));
      });
      mPage.on("pageerror", (err) => pageErrors.push(String(err.message || err).slice(0, 240)));
      try {
        try {
          await mPage.goto(normalizedUrl, { waitUntil: "networkidle", timeout: timeoutMs });
        } catch {
          await mPage.goto(normalizedUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        }
        await scrollAndSettlePage(mPage, { waitMs: Math.min(waitMs, 900) });
        if (deterministic) await lockDeterministicFrame(mPage, FIRST_LOCK_MS);
        mobileHeroPath = path.join(screenshotsDir, "mobile-hero.png");
        mobileFullPath = path.join(screenshotsDir, "mobile-full.png");
        await mPage.screenshot({ path: mobileHeroPath, fullPage: false });

        mobileMetrics = await mPage.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          hasHamburgerMenu: Boolean(
            document.querySelector(
              "button[aria-label*='menu' i], button[class*='menu' i], button[class*='burger' i], [aria-controls*='nav' i]"
            )
          ),
        }));

        if (mobileMetrics.scrollHeight <= 20000) {
          await mPage.screenshot({ path: mobileFullPath, fullPage: true });
        } else {
          await mPage.screenshot({
            path: mobileFullPath,
            fullPage: true,
            clip: { x: 0, y: 0, width: 390, height: 20000 },
          });
        }
        if (captureRuntime) {
          await mPage
            .evaluate(() => {
              const c = window.__SITE_REA_CLOCK__;
              if (c) {
                c.setFrozen(false);
                c.step(1);
              }
            })
            .catch(() => {});
          await exercisePage(mPage, { waitMs: 600 }).catch(() => {});
        }
      } catch (err) {
        warnings.push(`Mobile capture skipped: ${err.message}`);
      } finally {
        await mobileCtx.close();
      }
    }

    // 2b. Turn the recordings into runtime-cache/, then rehearse the mirror with
    // the internet cut off and fill whatever it still asks for.
    let runtimeCacheInfo = null;
    if (captureRuntime) {
      runtimeCacheInfo = await buildRuntimeCache({ evidenceDir, pageUrl: blueprintData.url, harPaths });
      if (runtimeCacheInfo.mediaIncomplete.length > 0) {
        warnings.push(`${runtimeCacheInfo.mediaIncomplete.length} media file(s) could only be recorded partially.`);
      }
      if (rehearse && runtimeCacheInfo.hasRootHtml) {
        try {
          const rehearsal = await rehearseRuntimeMirror({
            evidenceDir,
            browser,
            deterministic,
            viewports: captureMobile ? ["desktop", "mobile"] : ["desktop"],
          });
          runtimeCacheInfo.rehearsal = rehearsal;
          runtimeCacheInfo.resourceCount = rehearsal.resourceCount;
          if (rehearsal.unresolvedCount > 0) {
            warnings.push(
              `Runtime mirror: ${rehearsal.unresolvedCount} request(s) could not be recorded (first: ${rehearsal.unresolved[0].url}).`
            );
          }
        } catch (err) {
          warnings.push(`Runtime mirror rehearsal failed: ${err.message}`);
        }
      }
    }

    // 3. Download & localize assets + save inline SVGs (network-intercepted first!)
    const { manifest: assetsManifest, urlToRelPath, saveBufferAsset } = await downloadAndSaveAssets({
      assets: blueprintData.assets,
      inlineSvgs: blueprintData.inlineSvgs,
      capturedResources,
      evidenceDir,
      pageUrl: blueprintData.url,
      downloadEnabled: downloadAssets,
    });

    rewriteBlueprintWithLocalAssets(blueprintData, urlToRelPath);

    // 4. Build instant 1:1 offline mirror
    let mirrorInfo = null;
    if (captureMirror && mirrorPayload) {
      mirrorInfo = await buildOfflineMirror({
        mirrorPayload,
        capturedResources,
        evidenceDir,
        urlToRelPath,
        saveBufferAsset,
        pageUrl: blueprintData.url,
      });
    }

    // 5. Persist structured Evidence files
    fs.writeFileSync(
      path.join(evidenceDir, "design-tokens.json"),
      JSON.stringify(designTokens, null, 2),
      "utf8"
    );
    fs.writeFileSync(
      path.join(evidenceDir, "blueprint.json"),
      JSON.stringify(
        {
          url: blueprintData.url,
          origin: blueprintData.origin,
          documentSize: blueprintData.documentSize,
          interactiveHints: blueprintData.interactiveHints,
          sections: blueprintData.sections,
        },
        null,
        2
      ),
      "utf8"
    );
    fs.writeFileSync(
      path.join(evidenceDir, "routes.json"),
      JSON.stringify(blueprintData.routes, null, 2),
      "utf8"
    );
    fs.writeFileSync(
      path.join(evidenceDir, "assets-manifest.json"),
      JSON.stringify(assetsManifest, null, 2),
      "utf8"
    );

    const downloadedCount = assetsManifest.filter((a) => a.downloaded === true).length;
    const svgCount = assetsManifest.filter((a) => a.source === "inline").length;
    const failedAssets = assetsManifest.filter((a) => a.downloaded === false).length;

    const summary = {
      status: "ok",
      capturedAt: new Date().toISOString(),
      deterministic,
      deterministicClock: clock,
      url: blueprintData.url,
      title: designTokens.meta.title,
      lang: designTokens.meta.lang,
      theme: designTokens.theme,
      evidenceDir,
      browserExecutable: executablePath,
      documentSize: blueprintData.documentSize,
      mobileMetrics,
      screenshots: {
        desktopHero: desktopHeroPath,
        desktopFull: desktopFullPath,
        mobileHero: mobileHeroPath,
        mobileFull: mobileFullPath,
      },
      mirror: mirrorInfo,
      runtimeCache: runtimeCacheInfo,
      topColors: {
        pageBackground: designTokens.pageBackground,
        backgrounds: designTokens.colors.backgrounds.slice(0, 5).map((c) => c.value),
        text: designTokens.colors.text.slice(0, 4).map((c) => c.value),
        accents: designTokens.colors.accents.slice(0, 5).map((c) => c.value),
      },
      fonts: {
        loaded: designTokens.fonts.loaded.slice(0, 10),
        links: designTokens.fonts.links,
      },
      assetsSummary: {
        downloaded: downloadedCount,
        inlineSvgs: svgCount,
        models3d: assetsManifest.filter((a) => a.type === "model" && a.downloaded).length,
        lottieAnimations: assetsManifest.filter((a) => a.type === "lottie" && a.downloaded).length,
        videos: assetsManifest.filter((a) => a.type === "video" && a.downloaded).length,
        failed: failedAssets,
      },
      richMediaSummary: {
        engines: richMedia.engines,
        shaderCount: richMedia.webgl.shaderCount,
        uniformCount: Object.keys(richMedia.webgl.uniforms || {}).length,
        webgpuSupported: Boolean(richMedia.webgpu?.supported),
        webgpuShaderCount: richMedia.webgpu?.shaderCount || 0,
        webgpuRenderPipelines: (richMedia.webgpu?.renderPipelines || []).length,
        webgpuComputePipelines: (richMedia.webgpu?.computePipelines || []).length,
        hasThreeSceneGraph: Boolean(richMedia.threeScene),
        canvasCount: richMedia.canvases.length,
        stickyCount: richMedia.stickyElements.length,
        scrollTriggerCount: richMedia.scrollTriggers.length,
        activeAnimationsCount: richMedia.activeAnimations.length,
      },
      scrollTimelineSummary: scrollTimeline
        ? {
            steps: scrollTimeline.steps,
            deterministic: Boolean(scrollTimeline.deterministic),
            animatedTracksCount: scrollTimeline.animatedTracksCount,
            uniformTrackCount: Object.keys(scrollTimeline.uniformTracks || {}).length,
            threeCameraKeyframes: (scrollTimeline.threeCameraTrack || []).length,
            threeMeshTrackCount: Object.keys(scrollTimeline.threeMeshTracks || {}).length,
            timelineFile: path.join(evidenceDir, "scroll-timeline.json"),
          }
        : null,
      apiContractsSummary: {
        recordedEndpoints: apiContracts.length,
        apiContractsPath,
      },
      interactiveSummary: {
        buttonCount: blueprintData.interactiveHints.buttons.length,
        tabs: blueprintData.interactiveHints.tabs,
        accordions: blueprintData.interactiveHints.accordions,
        forms: blueprintData.interactiveHints.forms.length,
        hasCarousels: blueprintData.interactiveHints.hasCarousels,
        hasStickyHeader: blueprintData.interactiveHints.hasStickyHeader,
      },
      routeCount: blueprintData.routes.length,
      sectionsIndex: blueprintData.sections.map((s) => ({
        index: s.index,
        role: s.role,
        tag: s.tag,
        heading: s.heading,
        textPreview: s.textPreview.slice(0, 90),
        boundingBox: s.boundingBox,
        screenshot: s.screenshot,
      })),
      warnings,
      consoleErrorsCount: consoleErrors.length,
      // Kept so verification can tell errors the clone introduced from errors
      // the original page already had (a missing favicon, a failing tracker).
      consoleErrors: Array.from(new Set(consoleErrors)).slice(0, 40),
      pageErrors: Array.from(new Set(pageErrors)).slice(0, 40),
    };

    fs.writeFileSync(path.join(evidenceDir, "manifest.json"), JSON.stringify(summary, null, 2), "utf8");
    return summary;
  } finally {
    await browser.close();
  }
}
