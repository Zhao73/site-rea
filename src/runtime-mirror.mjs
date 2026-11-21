import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createRuntimeMirrorServer,
  openRuntimeCache,
  bodyKeyFor,
  TRACKER_RE,
} from "./mirror-runtime/server.mjs";
import {
  startBlackholeProxy,
  listenEphemeral,
  closeServer,
  gotoSettled,
  exercisePage,
  collectDomResourceUrls,
} from "./mirror-harness.mjs";
import { buildDeterministicClockInitScript, getEvidenceClock } from "./deterministic-clock.mjs";
import { attachExactReplay } from "./exact-replay.mjs";

const RUNTIME_SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "mirror-runtime");
const RUNTIME_FILES = ["server.mjs", "mirror-sw.js", "mirror-prelude.js"];

export const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
export const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export function isAnalyticsUrl(urlStr) {
  return TRACKER_RE.test(String(urlStr || ""));
}

/** Where a recording context should write its HAR (bodies are stored next to it). */
export function harRecordingPath(evidenceDir, name) {
  const dir = path.join(evidenceDir, "runtime-cache", "raw", name);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "recording.har");
}

/**
 * Reads a HAR (Playwright's, with bodies attached as files, or a DevTools
 * export with bodies inline) into the runtime cache. Request headers are never
 * stored, so cookies and authorization tokens stay out of the recording.
 */
export function importHarIntoCache(cache, harPath) {
  if (!fs.existsSync(harPath)) return { imported: 0, skipped: 0 };
  const har = JSON.parse(fs.readFileSync(harPath, "utf8"));
  const harDir = path.dirname(harPath);
  const seen = new Set(
    cache.index.entries.map((e) => `${e.method} ${e.url} ${e.bodyKey || ""} ${e.status} ${e.file || ""}`)
  );
  let imported = 0;
  let skipped = 0;

  for (const entry of har?.log?.entries || []) {
    const url = entry?.request?.url;
    const status = Number(entry?.response?.status || 0);
    if (!url || !/^https?:/i.test(url) || status < 100 || isAnalyticsUrl(url)) {
      skipped++;
      continue;
    }
    const method = String(entry.request.method || "GET").toUpperCase();
    if (method === "OPTIONS" || method === "CONNECT") {
      skipped++;
      continue;
    }
    const content = entry.response.content || {};
    let buffer = null;
    if (content._file) {
      const filePath = path.join(harDir, content._file);
      if (fs.existsSync(filePath)) buffer = fs.readFileSync(filePath);
    } else if (typeof content.text === "string" && content.text.length > 0) {
      buffer = content.encoding === "base64" ? Buffer.from(content.text, "base64") : Buffer.from(content.text, "utf8");
    }
    const isBodyless = [204, 205, 304].includes(status) || (status >= 300 && status < 400) || method === "HEAD";
    if (!buffer && !isBodyless) {
      // A response whose body the browser never exposed cannot be replayed.
      skipped++;
      continue;
    }
    const headers = (entry.response.headers || [])
      .filter((h) => h && h.name && !h.name.startsWith(":"))
      .map((h) => [h.name.toLowerCase(), String(h.value)]);
    if (!headers.some(([k]) => k === "content-type") && content.mimeType) {
      headers.push(["content-type", content.mimeType]);
    }
    const bodyKey = bodyKeyFor(entry.request.postData?.text ?? null);
    const before = cache.index.entries.length;
    const added = cache.add({ method, url, status, headers, buffer, bodyKey, source: "recorded" });
    const key = `${added.method} ${added.url} ${added.bodyKey || ""} ${added.status} ${added.file || ""}`;
    if (seen.has(key)) {
      cache.index.entries.length = before;
      skipped++;
      continue;
    }
    seen.add(key);
    imported++;
  }
  return { imported, skipped };
}

/**
 * Media is streamed in byte ranges, so a recording only holds the pieces that
 * happened to play. Fetch each such file once in full so seeking works offline.
 */
export async function completePartialMedia(cache, { referer, maxBytes = 250 * 1024 * 1024, timeoutMs = 60000 } = {}) {
  const partialOnly = new Map();
  const complete = new Set();
  for (const e of cache.index.entries) {
    if (e.method !== "GET") continue;
    if (e.status === 200) complete.add(e.url);
    else if (e.status === 206) partialOnly.set(e.url, e);
  }
  const done = [];
  const failed = [];
  for (const url of partialOnly.keys()) {
    if (complete.has(url)) continue;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: { "user-agent": DESKTOP_UA, ...(referer ? { referer } : {}) }, signal: ctrl.signal });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const declared = Number(res.headers.get("content-length") || "0");
      if (declared > maxBytes) throw new Error(`larger than ${Math.round(maxBytes / 1048576)} MB`);
      const buf = Buffer.from(await res.arrayBuffer());
      const headers = [];
      res.headers.forEach((v, k) => headers.push([k, v]));
      cache.add({ method: "GET", url, status: 200, headers, buffer: buf, source: "media-completed" });
      done.push({ url, bytes: buf.length });
    } catch (err) {
      failed.push({ url, error: String(err.message || err) });
    } finally {
      clearTimeout(timer);
    }
  }
  return { completed: done, failed };
}

/** Builds runtime-cache/ from the HAR files recorded during capture. */
export async function buildRuntimeCache({ evidenceDir, pageUrl, harPaths, completeMedia = true }) {
  const cacheDir = path.join(evidenceDir, "runtime-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  // A fresh capture replaces the previous recording instead of piling onto it.
  fs.rmSync(path.join(cacheDir, "index.json"), { force: true });
  const cache = openRuntimeCache(cacheDir);
  cache.index.pageUrl = pageUrl;
  cache.index.origin = new URL(pageUrl).origin;
  cache.index.capturedAt = new Date().toISOString();

  let imported = 0;
  for (const harPath of harPaths) {
    imported += importHarIntoCache(cache, harPath).imported;
  }
  const media = completeMedia ? await completePartialMedia(cache, { referer: pageUrl }) : { completed: [], failed: [] };
  cache.save();
  fs.rmSync(path.join(cacheDir, "raw"), { recursive: true, force: true });

  const origins = new Set(cache.index.entries.map((e) => new URL(e.url).origin));
  return {
    cacheDir,
    indexPath: path.join(cacheDir, "index.json"),
    resourceCount: cache.index.entries.length,
    importedFromRecording: imported,
    originsCount: origins.size,
    hasRootHtml: cache.index.entries.some((e) => e.mime === "text/html" && e.status === 200),
    mediaCompleted: media.completed.length,
    mediaIncomplete: media.failed,
  };
}

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, userAgent: DESKTOP_UA },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: MOBILE_UA },
};

/**
 * Runs the mirror with the internet cut off and lets the server fetch whatever
 * the page asks for that the recording lacks. Repeats until a pass needs
 * nothing new. What is still missing afterwards is reported, not hidden.
 */
export async function rehearseRuntimeMirror({
  evidenceDir,
  browser,
  maxPasses = 3,
  viewports = ["desktop", "mobile"],
  deterministic = false,
  waitMs = 900,
} = {}) {
  const cacheDir = path.join(evidenceDir, "runtime-cache");
  const server = createRuntimeMirrorServer({ cacheDir, mode: "record" });
  const base = await listenEphemeral(server);
  const blackhole = await startBlackholeProxy();
  const { cache, report } = server.siteRea;
  const startPath = (() => {
    const u = new URL(cache.index.pageUrl);
    return u.pathname + u.search;
  })();

  const passes = [];
  let sweptUrls = 0;
  // Exact-origin replay shares the server's cache, so both ways of running the
  // mirror are rehearsed and whatever either one lacks is recorded once.
  let exact = null;
  const clockScript = deterministic ? buildDeterministicClockInitScript(getEvidenceClock(evidenceDir)) : null;
  try {
    for (let pass = 1; pass <= maxPasses; pass++) {
      server.siteRea.resetReport();
      if (exact) exact.resetReport();
      for (const name of viewports) {
        // 1) exact origin: the recording answers under the real URL.
        const exactCtx = await browser.newContext({ ...VIEWPORTS[name], proxy: blackhole.proxy, serviceWorkers: "block", ignoreHTTPSErrors: true });
        try {
          exact = await attachExactReplay(exactCtx, cacheDir, {
            mode: "record",
            shared: exact || { cache, report: null, missSeen: null },
          });
          const page = await exactCtx.newPage();
          if (clockScript) await page.addInitScript(clockScript);
          await gotoSettled(page, cache.index.pageUrl);
          await exercisePage(page, { waitMs });
        } catch {
          // A viewport that fails to load still leaves its misses in the report.
        } finally {
          await exactCtx.close();
        }

        // 2) portable: the local server on 127.0.0.1 behind the service worker.
        const context = await browser.newContext({ ...VIEWPORTS[name], proxy: blackhole.proxy });
        const page = await context.newPage();
        if (clockScript) await page.addInitScript(clockScript);
        try {
          await gotoSettled(page, base + startPath);
          await exercisePage(page, { waitMs });
          if (pass === 1) {
            // Ask the server for every URL the DOM references but did not load here.
            const urls = (await collectDomResourceUrls(page)).filter((u) => !isAnalyticsUrl(u)).slice(0, 600);
            const mirrorOrigin = new URL(base).origin;
            for (const raw of urls) {
              let original = raw;
              if (raw.startsWith(mirrorOrigin)) {
                const rest = raw.slice(mirrorOrigin.length);
                if (rest.startsWith("/__rea__/")) continue;
                original = cache.index.origin + rest;
              }
              if (cache.lookup("GET", original, null)?.match === "exact") continue;
              const u = new URL(original);
              await fetch(`${base}/__rea__/fetch/${encodeURIComponent(u.origin)}${u.pathname}${u.search}`).catch(() => {});
              sweptUrls++;
            }
          }
        } catch {
        } finally {
          await context.close();
        }
      }
      const healed = report.healed.length + (exact ? exact.report.healed.length : 0);
      const unresolvedNow =
        report.healFailed.length + report.misses.length + (exact ? exact.report.healFailed.length + exact.report.misses.length : 0);
      passes.push({ pass, healed, unresolved: unresolvedNow });
      if (healed === 0) break;
    }
    cache.save();
    const seenUnresolved = new Set();
    const unresolved = [
      ...report.healFailed.map((f) => ({ url: f.url, method: f.method, reason: f.error })),
      ...report.misses.map((m) => ({ url: m.url, method: m.method, reason: "not recorded" })),
      ...(exact ? exact.report.healFailed.map((f) => ({ url: f.url, method: f.method, reason: f.error })) : []),
    ].filter((u) => {
      const k = `${u.method} ${u.url}`;
      if (seenUnresolved.has(k)) return false;
      seenUnresolved.add(k);
      return true;
    });
    return {
      passes,
      sweptUrls,
      resourceCount: cache.index.entries.length,
      healedTotal: passes.reduce((n, p) => n + p.healed, 0),
      unresolved: unresolved.slice(0, 50),
      unresolvedCount: unresolved.length,
      externalAttemptsBlocked: blackhole.attempts.length,
    };
  } finally {
    await closeServer(server);
    await blackhole.close();
  }
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

/**
 * Writes a standalone runtime-mirror project: the recording plus a
 * zero-dependency server. `node server.mjs` is all it needs.
 */
export function scaffoldRuntimeMirror({ evidenceDir, targetDir, port = 4175 }) {
  const resolvedEvidence = path.resolve(evidenceDir);
  const resolvedTarget = path.resolve(targetDir);
  const srcCache = path.join(resolvedEvidence, "runtime-cache");
  if (!fs.existsSync(path.join(srcCache, "index.json"))) {
    throw new Error(
      `runtime-cache/index.json not found in ${resolvedEvidence}. Re-run capture_site with capture_runtime: true.`
    );
  }

  fs.mkdirSync(resolvedTarget, { recursive: true });
  fs.rmSync(path.join(resolvedTarget, "runtime-cache"), { recursive: true, force: true });
  const copiedFiles = copyDirRecursive(srcCache, path.join(resolvedTarget, "runtime-cache"));
  for (const name of RUNTIME_FILES) {
    fs.copyFileSync(path.join(RUNTIME_SRC_DIR, name), path.join(resolvedTarget, name));
  }

  const index = JSON.parse(fs.readFileSync(path.join(srcCache, "index.json"), "utf8"));
  const entries = index.entries || [];
  const origins = new Set(entries.map((e) => new URL(e.url).origin));
  fs.writeFileSync(
    path.join(resolvedTarget, "package.json"),
    JSON.stringify(
      {
        name: "site-rea-runtime-mirror",
        private: true,
        type: "module",
        scripts: { start: `node server.mjs --port ${Number(port) || 4175}` },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const serverPath = path.join(resolvedTarget, "server.mjs");
  return {
    status: "ok",
    mode: "runtime-mirror",
    targetDir: resolvedTarget,
    serverPath,
    copiedFiles,
    cachedResources: entries.length,
    originsRecorded: origins.size,
    recordedApiResponses: entries.filter((e) => e.mime === "application/json" || e.method !== "GET").length,
    startCommand: `node "${serverPath}" --port ${Number(port) || 4175}`,
    notes:
      "Runtime mirror ready. It serves only what was recorded; run verify_clone to see whether anything the page asks for is missing (verification runs with the internet cut off).",
  };
}
