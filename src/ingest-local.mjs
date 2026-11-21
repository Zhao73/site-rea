import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { launchBrowser, scrollAndSettlePage, attachResourceCollector } from "./browser.mjs";
import { startStaticServer } from "./static-server.mjs";
import { extractDesignTokens, extractBlueprintAndAssets, extractFrozenMirror } from "./extractor.mjs";
import { downloadAndSaveAssets, rewriteBlueprintWithLocalAssets, buildOfflineMirror } from "./assets.mjs";
import { WEBGL_MOTION_INIT_SCRIPT, extractMotionAndWebglRuntime, persistWebglAndMotionEvidence } from "./webgl-motion.mjs";
import { redactSensitiveObject, inferJsonSchema, saveApiContracts } from "./api-mock.mjs";
import { openRuntimeCache } from "./mirror-runtime/server.mjs";
import { importHarIntoCache } from "./runtime-mirror.mjs";
import { cropSectionScreenshots } from "./section-shots.mjs";

function parseHarArchive(harPath) {
  const raw = JSON.parse(fs.readFileSync(harPath, "utf8"));
  const entries = raw?.log?.entries || [];
  const resourceMap = new Map();
  const apiContracts = [];
  const seenApi = new Set();
  let primaryHtml = null;
  let primaryUrl = null;

  for (const entry of entries) {
    const reqUrl = entry?.request?.url;
    const method = (entry?.request?.method || "GET").toUpperCase();
    const status = Number(entry?.response?.status || 0);
    if (!reqUrl || status < 200 || status >= 400) continue;

    const mime = (entry?.response?.content?.mimeType || "").toLowerCase();
    const text = entry?.response?.content?.text;
    const encoding = entry?.response?.content?.encoding;
    if (!text) continue;

    const buf = encoding === "base64" ? Buffer.from(text, "base64") : Buffer.from(text, "utf8");

    if (!primaryHtml && mime.includes("text/html") && method === "GET") {
      primaryHtml = buf.toString("utf8");
      primaryUrl = reqUrl;
    }

    if (mime.includes("application/json") || mime.includes("+json")) {
      try {
        const parsedUrl = new URL(reqUrl);
        const dedupeKey = `${method} ${parsedUrl.origin}${parsedUrl.pathname}`;
        if (!seenApi.has(dedupeKey)) {
          seenApi.add(dedupeKey);
          const jsonBody = JSON.parse(buf.toString("utf8"));
          const sanitized = redactSensitiveObject(jsonBody);
          let reqJson = null;
          const postText = entry?.request?.postData?.text;
          if (postText) {
            try { reqJson = redactSensitiveObject(JSON.parse(postText)); } catch {}
          }
          apiContracts.push({
            method,
            origin: parsedUrl.origin,
            pathname: parsedUrl.pathname,
            queryKeys: Array.from(parsedUrl.searchParams.keys()),
            status,
            requestSchema: reqJson && typeof reqJson === "object" ? inferJsonSchema(reqJson) : null,
            responseSchema: inferJsonSchema(sanitized),
            sampleResponse: sanitized,
          });
        }
      } catch {}
    }

    if (buf.length > 0 && buf.length <= 15 * 1024 * 1024) {
      resourceMap.set(reqUrl, {
        url: reqUrl,
        contentType: mime,
        resourceType: mime.includes("css") ? "stylesheet" : mime.includes("font") ? "font" : mime.includes("image") ? "image" : "other",
        buffer: buf,
      });
    }
  }

  return { primaryHtml, primaryUrl, resourceMap, apiContracts, totalHarEntries: entries.length };
}

/**
 * Completely offline ingestion of a user-supplied local HTML / SingleFile HTML / saved webpage folder
 * and/or Chrome DevTools HAR archive. Never contacts external protected sites or bypasses any gate.
 */
export async function ingestLocalArchive({
  htmlPath,
  harPath,
  outputDir,
  captureMobile = true,
  waitMs = 600,
  maxSections = 25,
} = {}) {
  if (!htmlPath && !harPath) {
    throw new Error("Provide at least one of html_path (local HTML/folder) or har_path (local .har file).");
  }

  let harData = null;
  if (harPath) {
    const resolvedHar = path.resolve(harPath);
    if (!fs.existsSync(resolvedHar)) throw new Error(`HAR file not found: ${resolvedHar}`);
    harData = parseHarArchive(resolvedHar);
  }

  let tempServeDir = null;
  let serveRoot = null;
  let entryRelPath = "/index.html";

  if (htmlPath) {
    const resolvedHtml = path.resolve(htmlPath);
    if (!fs.existsSync(resolvedHtml)) throw new Error(`Local HTML path not found: ${resolvedHtml}`);
    const stat = fs.statSync(resolvedHtml);
    if (stat.isDirectory()) {
      serveRoot = resolvedHtml;
      entryRelPath = "/index.html";
    } else {
      serveRoot = path.dirname(resolvedHtml);
      entryRelPath = "/" + encodeURIComponent(path.basename(resolvedHtml));
    }
  } else if (harData?.primaryHtml) {
    tempServeDir = fs.mkdtempSync(path.join(os.tmpdir(), "site-rea-har-"));
    fs.writeFileSync(path.join(tempServeDir, "index.html"), harData.primaryHtml, "utf8");
    serveRoot = tempServeDir;
    entryRelPath = "/index.html";
  }

  const slug = path.basename(htmlPath || harPath || "local-archive").replace(/[^a-zA-Z0-9.-]+/g, "-").toLowerCase();
  const evidenceDir = path.resolve(
    outputDir || path.join(os.homedir(), ".gemini", "antigravity", "scratch", `site-rea-local-${slug}`, ".site-rea")
  );
  const screenshotsDir = path.join(evidenceDir, "screenshots");
  const sectionsDir = path.join(screenshotsDir, "sections");
  fs.mkdirSync(sectionsDir, { recursive: true });

  // Always save redacted HAR API contracts if present
  let apiContractsPath = null;
  if (harData) {
    apiContractsPath = saveApiContracts(evidenceDir, harData.apiContracts);
  }

  // A HAR that contains the page itself is a complete recording: turn it into a
  // runtime-cache so `scaffold --mode runtime-mirror` works without any network.
  let runtimeCacheInfo = null;
  if (harData?.primaryUrl) {
    const cacheDir = path.join(evidenceDir, "runtime-cache");
    fs.rmSync(path.join(cacheDir, "index.json"), { force: true });
    const cache = openRuntimeCache(cacheDir);
    cache.index.pageUrl = harData.primaryUrl;
    cache.index.origin = new URL(harData.primaryUrl).origin;
    cache.index.capturedAt = new Date().toISOString();
    const { imported } = importHarIntoCache(cache, path.resolve(harPath));
    cache.save();
    runtimeCacheInfo = { cacheDir, resourceCount: imported, source: "har" };
  }

  // If HAR had no HTML and no htmlPath was given, return HAR-only contract/asset summary cleanly
  if (!serveRoot) {
    return {
      status: "ok",
      mode: "har-api-only",
      evidenceDir,
      totalHarEntries: harData?.totalHarEntries || 0,
      apiContractsCount: harData?.apiContracts?.length || 0,
      apiContractsPath,
      notes: "HAR archive contained no primary HTML document; extracted sanitized API contracts for mock backend scaffolding.",
    };
  }

  const localServer = await startStaticServer(serveRoot, { port: 0 });
  const targetUrl = `${localServer.url}${entryRelPath}`;
  const { browser, executablePath } = await launchBrowser();
  const warnings = [];

  try {
    const setupHarRouting = async (page) => {
      await page.route("**/*", (route) => {
        const reqUrl = route.request().url();
        // Always allow our local ephemeral server & data/blob URIs
        if (reqUrl.startsWith(localServer.url) || reqUrl.startsWith("data:") || reqUrl.startsWith("blob:")) {
          return route.continue();
        }
        // Fulfill external assets from HAR offline if available
        if (harData?.resourceMap?.has(reqUrl)) {
          const hit = harData.resourceMap.get(reqUrl);
          return route.fulfill({
            status: 200,
            contentType: hit.contentType || "application/octet-stream",
            body: hit.buffer,
          });
        }
        // Strict offline boundary: abort unrecorded external network requests
        return route.abort();
      });
    };

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.addInitScript(WEBGL_MOTION_INIT_SCRIPT);
    await setupHarRouting(page);
    const collector = attachResourceCollector(page);

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await scrollAndSettlePage(page, { waitMs });

    const desktopHeroPath = path.join(screenshotsDir, "desktop-hero.png");
    await page.screenshot({ path: desktopHeroPath, fullPage: false });

    const designTokens = await extractDesignTokens(page);
    const blueprintData = await extractBlueprintAndAssets(page, { maxSections });
    const runtimeData = await extractMotionAndWebglRuntime(page);
    const richMedia = persistWebglAndMotionEvidence(evidenceDir, runtimeData);

    const desktopFullPath = path.join(screenshotsDir, "desktop-full.png");
    const docW = Math.min(1440, Math.max(1, blueprintData.documentSize.viewportWidth || 1440));
    const docH = Math.min(20000, Math.max(900, blueprintData.documentSize.scrollHeight || 900));
    if (blueprintData.documentSize.scrollHeight <= 20000) {
      await page.screenshot({ path: desktopFullPath, fullPage: true });
    } else {
      await page.screenshot({ path: desktopFullPath, fullPage: true, clip: { x: 0, y: 0, width: docW, height: docH } });
    }

    warnings.push(...cropSectionScreenshots({ fullPagePath: desktopFullPath, sections: blueprintData.sections, sectionsDir }));

    const mirrorPayload = await extractFrozenMirror(page);
    const capturedResources = await collector.flush();
    // Merge HAR recorded assets into capturedResources so offline localization captures everything
    if (harData?.resourceMap) {
      for (const [k, v] of harData.resourceMap.entries()) {
        if (!capturedResources.has(k)) capturedResources.set(k, v);
      }
    }
    await context.close();

    // Mobile capture
    let mobileHeroPath = null;
    let mobileFullPath = null;
    if (captureMobile) {
      const mCtx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      });
      const mPage = await mCtx.newPage();
      await setupHarRouting(mPage);
      try {
        await mPage.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await scrollAndSettlePage(mPage, { waitMs: 400 });
        mobileHeroPath = path.join(screenshotsDir, "mobile-hero.png");
        mobileFullPath = path.join(screenshotsDir, "mobile-full.png");
        await mPage.screenshot({ path: mobileHeroPath, fullPage: false });
        await mPage.screenshot({ path: mobileFullPath, fullPage: true });
      } catch (err) {
        warnings.push(`Mobile offline capture skipped: ${err.message}`);
      } finally {
        await mCtx.close();
      }
    }

    const { manifest: assetsManifest, urlToRelPath, saveBufferAsset } = await downloadAndSaveAssets({
      assets: blueprintData.assets,
      inlineSvgs: blueprintData.inlineSvgs,
      capturedResources,
      evidenceDir,
      pageUrl: targetUrl,
      downloadEnabled: true,
      allowRemoteFetch: false, // STRICT OFFLINE for local archive ingestion!
    });

    rewriteBlueprintWithLocalAssets(blueprintData, urlToRelPath);
    const mirrorInfo = await buildOfflineMirror({
      mirrorPayload,
      capturedResources,
      evidenceDir,
      urlToRelPath,
      saveBufferAsset,
      pageUrl: targetUrl,
      allowRemoteFetch: false,
    });

    fs.writeFileSync(path.join(evidenceDir, "design-tokens.json"), JSON.stringify(designTokens, null, 2), "utf8");
    fs.writeFileSync(
      path.join(evidenceDir, "blueprint.json"),
      JSON.stringify(
        {
          url: harData?.primaryUrl || htmlPath || harPath,
          origin: "local-archive",
          documentSize: blueprintData.documentSize,
          interactiveHints: blueprintData.interactiveHints,
          sections: blueprintData.sections,
        },
        null,
        2
      ),
      "utf8"
    );
    fs.writeFileSync(path.join(evidenceDir, "routes.json"), JSON.stringify(blueprintData.routes, null, 2), "utf8");
    fs.writeFileSync(path.join(evidenceDir, "assets-manifest.json"), JSON.stringify(assetsManifest, null, 2), "utf8");

    const summary = {
      status: "ok",
      mode: "offline-local-archive",
      capturedAt: new Date().toISOString(),
      sourceHtmlPath: htmlPath ? path.resolve(htmlPath) : null,
      sourceHarPath: harPath ? path.resolve(harPath) : null,
      title: designTokens.meta.title,
      theme: designTokens.theme,
      evidenceDir,
      browserExecutable: executablePath,
      documentSize: blueprintData.documentSize,
      screenshots: {
        desktopHero: desktopHeroPath,
        desktopFull: desktopFullPath,
        mobileHero: mobileHeroPath,
        mobileFull: mobileFullPath,
      },
      mirror: mirrorInfo,
      runtimeCache: runtimeCacheInfo,
      richMediaSummary: {
        engines: richMedia.engines,
        shaderCount: richMedia.webgl.shaderCount,
        canvasCount: richMedia.canvases.length,
      },
      apiContractsCount: harData?.apiContracts?.length || 0,
      apiContractsPath,
      assetsSummary: {
        localized: assetsManifest.filter((a) => a.downloaded === true).length,
        inlineSvgs: assetsManifest.filter((a) => a.source === "inline").length,
      },
      sectionsIndex: blueprintData.sections.map((s) => ({
        index: s.index,
        role: s.role,
        tag: s.tag,
        heading: s.heading,
        boundingBox: s.boundingBox,
        screenshot: s.screenshot,
      })),
      warnings,
    };

    fs.writeFileSync(path.join(evidenceDir, "manifest.json"), JSON.stringify(summary, null, 2), "utf8");
    return summary;
  } finally {
    await browser.close();
    await localServer.close();
    if (tempServeDir) fs.rmSync(tempServeDir, { recursive: true, force: true });
  }
}
