#!/usr/bin/env node
/**
 * Site-REA runtime-mirror server (zero dependencies, Node 18+).
 *
 * Replays a recorded website from runtime-cache/ so the original front-end
 * (JS bundles, lazy chunks, workers, WASM, 3D assets, API responses) runs on
 * http://127.0.0.1 without touching the original servers.
 *
 * How it works:
 *   - A service worker (mirror-sw.js) takes over every request the page makes,
 *     including cross-origin <script>/<link>/<img>/import(), and forwards it to
 *     /__rea__/fetch/<origin>/<path>. Page code keeps seeing the original URLs.
 *   - This server answers from the recording, matched by method + URL + body.
 *   - In `record` mode a cache miss is fetched from the origin once and stored,
 *     which is how capture fills holes. In the default `offline` mode a miss is
 *     a 404 and is listed at /__rea__/report — nothing is fetched.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const TRACKER_RE =
  /(google-analytics\.com|googletagmanager\.com|doubleclick\.net|googlesyndication\.com|googleadservices\.com|connect\.facebook\.net|facebook\.com\/tr|analytics\.tiktok\.com|sentry\.io|sentry-cdn\.com|hotjar\.com|clarity\.ms|cdn\.segment\.com|api\.segment\.io|mixpanel\.com|amplitude\.com|intercom\.io|intercomcdn\.com|plausible\.io|posthog\.com|fullstory\.com|logrocket\.com|datadoghq\.com|browser-intake-|newrelic\.com|nr-data\.net|hm\.baidu\.com|cnzz\.com|bat\.bing\.com|snap\.licdn\.com|px\.ads\.linkedin\.com|stats\.g\.doubleclick\.net)/i;

// Response headers that must not be replayed: transport-level ones describe the
// original connection, security ones would block the mirror from running locally.
const DROP_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "content-security-policy",
  "content-security-policy-report-only",
  "strict-transport-security",
  "set-cookie",
  "alt-svc",
  "report-to",
  "nel",
  "x-frame-options",
  "permissions-policy",
  // A Link header makes the browser preconnect/preload from the original hosts directly.
  "link",
  "location",
  "content-range",
  "accept-ranges",
]);

const MIME_EXT = {
  "text/html": ".html",
  "text/css": ".css",
  "application/javascript": ".js",
  "text/javascript": ".js",
  "application/x-javascript": ".js",
  "application/json": ".json",
  "application/wasm": ".wasm",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/x-icon": ".ico",
  "image/vnd.microsoft.icon": ".ico",
  "font/woff2": ".woff2",
  "font/woff": ".woff",
  "font/ttf": ".ttf",
  "font/otf": ".otf",
  "model/gltf-binary": ".glb",
  "model/gltf+json": ".gltf",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "text/plain": ".txt",
  "text/x-component": ".rsc",
};

export function extForResource(urlStr, mime) {
  if (mime && MIME_EXT[mime]) return MIME_EXT[mime];
  try {
    const ext = path.extname(new URL(urlStr).pathname).toLowerCase();
    if (ext && ext.length <= 10 && /^\.[a-z0-9]+$/.test(ext)) return ext;
  } catch {}
  return ".bin";
}

export function sha1(input) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

/**
 * A stable key for the request body: GraphQL operations are matched by
 * operation name (their variables often carry timestamps), anything else by hash.
 */
export function bodyKeyFor(bodyText) {
  if (bodyText === null || bodyText === undefined || bodyText === "") return null;
  const text = Buffer.isBuffer(bodyText) ? bodyText.toString("utf8") : String(bodyText);
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && typeof parsed.operationName === "string" && parsed.operationName) {
      return `op:${parsed.operationName}`;
    }
  } catch {}
  return `sha1:${sha1(text)}`;
}

function stripHash(urlStr) {
  const i = urlStr.indexOf("#");
  return i === -1 ? urlStr : urlStr.slice(0, i);
}

function statusRank(status) {
  if (status === 0) return 9; // "unreachable on the real site" only wins when nothing else exists
  if (status >= 200 && status < 300 && status !== 206) return 0;
  if (status === 206) return 1;
  if (status >= 300 && status < 400) return 2;
  return 3;
}

/** Loads runtime-cache/index.json and provides lookup + append for record mode. */
export function openRuntimeCache(cacheDir) {
  const indexPath = path.join(cacheDir, "index.json");
  const filesDir = path.join(cacheDir, "files");
  fs.mkdirSync(filesDir, { recursive: true });

  let index = { version: 2, pageUrl: null, origin: null, capturedAt: null, entries: [] };
  if (fs.existsSync(indexPath)) {
    const raw = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    if (Array.isArray(raw.entries)) {
      index = raw;
    } else if (raw.byUrl) {
      // Format written before entries[] existed: one GET per URL, no headers kept.
      index = {
        version: 2,
        pageUrl: raw.pageUrl,
        origin: raw.origin,
        capturedAt: raw.capturedAt,
        entries: Object.values(raw.byUrl).map((m) => ({
          method: "GET",
          url: m.url,
          status: 200,
          headers: [["content-type", m.contentType || "application/octet-stream"]],
          mime: String(m.contentType || "").split(";")[0].trim().toLowerCase(),
          file: m.file,
          bytes: m.bytes,
          bodyKey: null,
        })),
      };
    }
  }

  const exact = new Map(); // "GET https://a/b?c" -> entry[]
  const byPath = new Map(); // "GET https://a/b" -> entry[]

  function indexEntry(entry) {
    const url = stripHash(entry.url);
    const k = `${entry.method} ${url}`;
    if (!exact.has(k)) exact.set(k, []);
    exact.get(k).push(entry);
    try {
      const u = new URL(url);
      const pk = `${entry.method} ${u.origin}${u.pathname}`;
      if (!byPath.has(pk)) byPath.set(pk, []);
      byPath.get(pk).push(entry);
    } catch {}
  }
  for (const e of index.entries) indexEntry(e);

  function best(list, bodyKey) {
    if (!list || list.length === 0) return null;
    let pool = list;
    if (bodyKey) {
      const sameBody = list.filter((e) => e.bodyKey === bodyKey);
      if (sameBody.length > 0) pool = sameBody;
    }
    // Prefer a complete successful response; among equals the most recent one.
    return pool.reduce((a, b) => (statusRank(b.status) <= statusRank(a.status) ? b : a));
  }

  function lookup(method, urlStr, bodyKey) {
    const url = stripHash(urlStr);
    const m = method === "HEAD" ? "GET" : method;
    const hit = best(exact.get(`${m} ${url}`), bodyKey);
    if (hit) return { entry: hit, match: "exact" };

    let u;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    // Same path, different query string: cache-busters, timestamps, resized
    // image variants. Pick the recording that shares the most parameters.
    const candidates = byPath.get(`${m} ${u.origin}${u.pathname}`);
    if (candidates && candidates.length > 0) {
      const want = new Set(Array.from(u.searchParams.entries()).map(([k, v]) => `${k}=${v}`));
      let top = null;
      let topScore = -1;
      for (const c of candidates) {
        let score = 0;
        try {
          for (const [k, v] of new URL(c.url).searchParams.entries()) if (want.has(`${k}=${v}`)) score += 2;
        } catch {}
        if (bodyKey && c.bodyKey === bodyKey) score += 3;
        score -= statusRank(c.status);
        if (score >= topScore) {
          top = c;
          topScore = score;
        }
      }
      if (top) return { entry: top, match: "fuzzy" };
    }
    return null;
  }

  function add({ method, url, status, headers, buffer, bodyKey = null, source = "recorded" }) {
    const ct = (headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] || "").toString();
    const mime = ct.split(";")[0].trim().toLowerCase();
    let file = null;
    if (buffer && buffer.length > 0) {
      file = `files/${sha1(buffer)}${extForResource(url, mime)}`;
      const abs = path.join(cacheDir, file);
      if (!fs.existsSync(abs)) fs.writeFileSync(abs, buffer);
    }
    const entry = {
      method,
      url: stripHash(url),
      status,
      headers,
      mime,
      file,
      bytes: buffer ? buffer.length : 0,
      bodyKey,
      source,
    };
    index.entries.push(entry);
    indexEntry(entry);
    return entry;
  }

  function save() {
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 1), "utf8");
  }

  return { cacheDir, index, lookup, add, save };
}

const FORWARDED_REQUEST_HEADERS = ["content-type", "rsc", "next-router-state-tree", "next-url", "next-router-prefetch", "x-requested-with"];

/**
 * Fetches one request from the original site and stores the answer in the
 * cache. Only used while recording; replay never calls it.
 */
export async function fetchIntoCache(
  cache,
  {
    method,
    url,
    reqHeaders = {},
    body = null,
    userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    timeoutMs = 30000,
    maxBytes = 250 * 1024 * 1024,
  }
) {
  const headers = { "user-agent": userAgent, accept: reqHeaders.accept || "*/*" };
  if (cache.index.pageUrl) headers.referer = cache.index.pageUrl;
  for (const h of FORWARDED_REQUEST_HEADERS) {
    if (reqHeaders[h]) headers[h] = reqHeaders[h];
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" || !body || body.length === 0 ? undefined : body,
      redirect: "manual",
      signal: ctrl.signal,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error("response too large");
    if (res.status >= 500) throw new Error(`upstream HTTP ${res.status}`);
    const outHeaders = [];
    res.headers.forEach((v, name) => outHeaders.push([name, v]));
    return cache.add({
      method,
      url,
      status: res.status,
      headers: outHeaders,
      buffer: buf,
      bodyKey: bodyKeyFor(body && body.length ? body : null),
      source: "healed",
    });
  } catch (err) {
    // The host does not exist or refuses connections: the request fails on the
    // real site too. Remember that, so replay fails it the same way instead of
    // reporting a hole in the recording. Timeouts are not treated as proof.
    if (err && err.name === "TypeError" && /fetch failed/i.test(String(err.message))) {
      return cache.add({
        method,
        url,
        status: 0,
        headers: [],
        buffer: null,
        bodyKey: bodyKeyFor(body && body.length ? body : null),
        source: "unreachable",
      });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function readRequestBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size <= limit) chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(Buffer.alloc(0)));
  });
}

const BOOTSTRAP_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Loading mirror…</title>
<style>body{font:14px system-ui,sans-serif;color:#555;display:grid;place-items:center;height:100vh;margin:0}</style></head>
<body><p id="m">Starting offline mirror…</p>
<script>
(async () => {
  const say = (t) => { document.getElementById("m").textContent = t; };
  if (!("serviceWorker" in navigator)) {
    say("This mirror needs service workers. Open it at http://127.0.0.1 or http://localhost in a normal (non-private) browser window.");
    return;
  }
  const tries = Number(sessionStorage.getItem("__rea_boot") || "0");
  if (tries >= 4) {
    sessionStorage.removeItem("__rea_boot");
    say("The mirror service worker could not take control of this page. Reload normally (not a hard reload).");
    return;
  }
  sessionStorage.setItem("__rea_boot", String(tries + 1));
  try {
    await navigator.serviceWorker.register("/__rea__/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
        setTimeout(resolve, 1500);
      });
    }
    location.reload();
  } catch (err) {
    say("Service worker registration failed: " + err.message);
  }
})();
</script></body></html>`;

function buildPrelude(cfg) {
  const src = fs.readFileSync(path.join(HERE, "mirror-prelude.js"), "utf8");
  return `<script data-site-rea="prelude">self.__REA_CFG__=${JSON.stringify(cfg)};${src}</script>`;
}

/**
 * Prepares a recorded HTML document for local replay. Works on latin1-decoded
 * bytes so Shift_JIS / EUC-JP pages survive untouched; everything inserted is ASCII.
 */
function prepareDocument(buffer, preludeTag, primaryOrigin) {
  let html = buffer.toString("latin1");
  // A <meta> CSP would block the injected prelude and the remapped requests.
  html = html.replace(/<meta[^>]+http-equiv\s*=\s*["']?content-security-policy(-report-only)?["']?[^>]*>/gi, "");
  // Connection hints open sockets to the original hosts and carry no content.
  html = html.replace(/<link[^>]+rel\s*=\s*["']?(?:preconnect|dns-prefetch)["']?[^>]*>/gi, "");
  // <base href="https://original/..."> would send every relative link to the live site.
  if (primaryOrigin) {
    html = html.replace(/(<base[^>]+href\s*=\s*["'])([^"']+)(["'])/i, (full, a, href, c) =>
      href.startsWith(primaryOrigin) ? a + (href.slice(primaryOrigin.length) || "/") + c : full
    );
  }
  const headOpen = html.match(/<head[^>]*>/i);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    html = html.slice(0, at) + preludeTag + html.slice(at);
  } else {
    const doctype = html.match(/^\s*<!doctype[^>]*>/i);
    const at = doctype ? doctype[0].length : 0;
    html = html.slice(0, at) + preludeTag + html.slice(at);
  }
  return Buffer.from(html, "latin1");
}

export function createRuntimeMirrorServer({
  cacheDir = path.join(HERE, "runtime-cache"),
  mode = "offline",
  upstreamTimeoutMs = 30000,
  maxUpstreamBytes = 250 * 1024 * 1024,
  userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
} = {}) {
  const cache = openRuntimeCache(cacheDir);
  const primaryOrigin = cache.index.origin;
  const pageUrl = cache.index.pageUrl;
  const swSource = fs.readFileSync(path.join(HERE, "mirror-sw.js"), "utf8");
  const cfg = { origin: primaryOrigin, pageUrl };
  const preludeTag = buildPrelude(cfg);
  const swBody = `self.__REA_CFG__=${JSON.stringify(cfg)};\n${swSource}`;

  const report = {
    mode,
    served: 0,
    fuzzy: [],
    misses: [],
    healed: [],
    healFailed: [],
    trackersStubbed: 0,
    clientLogs: [],
  };
  const missSeen = new Set();
  const inflight = new Map();

  function noteMiss(method, url, dest) {
    const k = `${method} ${url}`;
    if (missSeen.has(k)) return;
    missSeen.add(k);
    report.misses.push({ method, url, dest: dest || "" });
  }

  async function fetchUpstream(method, url, reqHeaders, body) {
    const k = `${method} ${url} ${body && body.length ? sha1(body) : ""}`;
    if (inflight.has(k)) return inflight.get(k);
    const task = fetchIntoCache(cache, { method, url, reqHeaders, body, userAgent, timeoutMs: upstreamTimeoutMs, maxBytes: maxUpstreamBytes })
      .then((entry) => {
        if (entry.status !== 0) report.healed.push({ method, url, status: entry.status, bytes: entry.bytes });
        return entry;
      })
      .catch((err) => {
        report.healFailed.push({ method, url, error: String(err.message || err) });
        return null;
      })
      .finally(() => inflight.delete(k));
    inflight.set(k, task);
    return task;
  }

  function locationFor(entry) {
    return entry.headers.find(([k]) => k.toLowerCase() === "location")?.[1] || null;
  }

  function send(req, res, entry, { viaSw, dest }) {
    const headers = {};
    for (const [k, v] of entry.headers) {
      const name = k.toLowerCase();
      if (DROP_RESPONSE_HEADERS.has(name) || name.startsWith(":")) continue;
      headers[name] = v;
    }
    headers["access-control-allow-origin"] = "*";
    headers["access-control-expose-headers"] = "*";
    headers["cross-origin-resource-policy"] = "cross-origin";
    headers["cache-control"] = "no-store";

    if (entry.status === 0) {
      // Unreachable on the real site: the service worker turns this into a network error.
      res.writeHead(viaSw ? 200 : 502, { "x-rea-status": "0", "access-control-allow-origin": "*", "cache-control": "no-store" });
      res.end();
      return;
    }
    const isRedirect = entry.status >= 300 && entry.status < 400;
    const loc = locationFor(entry);
    let status = entry.status;

    if (viaSw) {
      // fetch() inside the service worker would follow a real 3xx on its own,
      // so the true status travels in a header and the worker rebuilds it.
      headers["x-rea-status"] = String(entry.status);
      if (isRedirect && loc) headers["x-rea-location"] = loc;
      status = 200;
    } else if (isRedirect && loc) {
      let target = loc;
      try {
        const abs = new URL(loc, entry.url);
        target = abs.origin === primaryOrigin ? abs.pathname + abs.search : `/__rea__/fetch/${encodeURIComponent(abs.origin)}${abs.pathname}${abs.search}`;
      } catch {}
      headers.location = target;
    }

    const noBody = req.method === "HEAD" || [204, 205, 304].includes(entry.status) || isRedirect || !entry.file;
    if (noBody) {
      res.writeHead(status, headers);
      res.end();
      return;
    }

    const abs = path.join(cacheDir, entry.file);
    if (!fs.existsSync(abs)) {
      res.writeHead(viaSw ? 200 : 404, { ...headers, "x-rea-status": "404" });
      res.end();
      return;
    }

    const isDoc = entry.mime === "text/html" && (dest === "document" || dest === "iframe" || dest === "frame");
    if (isDoc) {
      const body = prepareDocument(fs.readFileSync(abs), preludeTag, primaryOrigin);
      res.writeHead(status, headers);
      res.end(body);
      return;
    }

    const size = fs.statSync(abs).size;
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range && entry.status === 200 && size > 0) {
      let start = range[1] === "" ? Math.max(0, size - Number(range[2])) : Number(range[1]);
      let end = range[1] !== "" && range[2] !== "" ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        res.writeHead(viaSw ? 200 : 416, { ...headers, "x-rea-status": "416", "content-range": `bytes */${size}` });
        res.end();
        return;
      }
      headers["content-range"] = `bytes ${start}-${end}/${size}`;
      headers["accept-ranges"] = "bytes";
      headers["content-length"] = String(end - start + 1);
      if (viaSw) headers["x-rea-status"] = "206";
      res.writeHead(206, headers);
      fs.createReadStream(abs, { start, end }).pipe(res);
      return;
    }
    if (entry.status === 206) {
      const cr = entry.headers.find(([k]) => k.toLowerCase() === "content-range")?.[1];
      if (cr) headers["content-range"] = cr;
    }
    headers["content-length"] = String(size);
    if (entry.status === 200) headers["accept-ranges"] = "bytes";
    res.writeHead(viaSw && entry.status !== 206 ? 200 : status, headers);
    fs.createReadStream(abs).pipe(res);
  }

  function sendNotFound(res, { viaSw, url }) {
    const headers = {
      "content-type": "text/plain; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      "x-rea-status": "404",
      "x-rea-miss": "1",
    };
    res.writeHead(viaSw ? 200 : 404, headers);
    res.end(`Not in the recording: ${url}`);
  }

  async function handleReplay(req, res, originalUrl, { viaSw }) {
    const method = (req.method || "GET").toUpperCase();
    const dest = String(req.headers["x-rea-dest"] || (viaSw ? "" : req.headers["sec-fetch-dest"] || ""));

    if (method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "*",
        "access-control-allow-headers": "*",
        "x-rea-status": "204",
      });
      res.end();
      return;
    }

    if (TRACKER_RE.test(originalUrl)) {
      report.trackersStubbed++;
      await readRequestBody(req);
      res.writeHead(viaSw ? 200 : 204, { "access-control-allow-origin": "*", "x-rea-status": "204" });
      res.end();
      return;
    }

    const body = method === "GET" || method === "HEAD" ? null : await readRequestBody(req);
    const bodyKey = bodyKeyFor(body && body.length ? body : null);

    let found = cache.lookup(method, originalUrl, bodyKey);
    if ((!found || found.match === "fuzzy") && mode === "record") {
      const healed = await fetchUpstream(method, originalUrl, req.headers, body);
      if (healed) found = { entry: healed, match: "healed" };
    }
    if (!found && dest === "document" && pageUrl && originalUrl === primaryOrigin + "/" && pageUrl !== originalUrl) {
      // The recorded page is not the site root: send "/" to the page that was captured.
      res.writeHead(viaSw ? 200 : 302, { "x-rea-status": "302", "x-rea-location": pageUrl, location: pageUrl.slice(primaryOrigin.length) });
      res.end();
      return;
    }
    if (!found) {
      noteMiss(method, originalUrl, dest);
      sendNotFound(res, { viaSw, url: originalUrl });
      return;
    }
    if (found.match === "fuzzy" && report.fuzzy.length < 500) {
      report.fuzzy.push({ method, requested: originalUrl, served: found.entry.url });
    }
    report.served++;
    send(req, res, found.entry, { viaSw, dest });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const rawUrl = req.url || "/";
      const q = rawUrl.indexOf("?");
      const pathname = q === -1 ? rawUrl : rawUrl.slice(0, q);

      if (pathname === "/__rea__/sw.js") {
        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
          "service-worker-allowed": "/",
          "cache-control": "no-store",
        });
        res.end(swBody);
        return;
      }
      if (pathname === "/__rea__/report") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(report, null, 1));
        return;
      }
      if (pathname === "/__rea__/log") {
        const body = await readRequestBody(req, 64 * 1024);
        if (report.clientLogs.length < 200) {
          try {
            report.clientLogs.push(JSON.parse(body.toString("utf8")));
          } catch {}
        }
        res.writeHead(204);
        res.end();
        return;
      }
      if (pathname.startsWith("/__rea__/fetch/")) {
        const rest = rawUrl.slice("/__rea__/fetch/".length);
        const slash = rest.indexOf("/");
        const originPart = slash === -1 ? rest : rest.slice(0, slash);
        let origin;
        try {
          origin = decodeURIComponent(originPart);
          new URL(origin);
        } catch {
          res.writeHead(400);
          res.end("Bad mirror URL");
          return;
        }
        const tail = slash === -1 ? "/" : rest.slice(slash);
        await handleReplay(req, res, origin + tail, { viaSw: req.headers["x-rea-sw"] === "1" });
        return;
      }

      // Reached without the service worker: a first visit or a hard reload.
      const fetchDest = String(req.headers["sec-fetch-dest"] || "");
      const wantsDocument =
        fetchDest === "document" || (!fetchDest && String(req.headers.accept || "").includes("text/html"));
      if (wantsDocument && (req.method || "GET").toUpperCase() === "GET") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(BOOTSTRAP_HTML);
        return;
      }
      if (!primaryOrigin) {
        res.writeHead(404);
        res.end("runtime-cache has no origin");
        return;
      }
      await handleReplay(req, res, primaryOrigin + rawUrl, { viaSw: false });
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(`Mirror server error: ${err?.message || err}`);
    }
  });

  server.siteRea = {
    cache,
    report,
    mode,
    /** Clears per-run counters so each rehearsal pass can be judged on its own. */
    resetReport() {
      report.served = 0;
      report.fuzzy.length = 0;
      report.misses.length = 0;
      report.healed.length = 0;
      report.healFailed.length = 0;
      report.trackersStubbed = 0;
      report.clientLogs.length = 0;
      missSeen.clear();
    },
    save: () => cache.save(),
  };
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const portFlag = args.indexOf("--port");
  const port = Number(portFlag !== -1 ? args[portFlag + 1] : process.env.PORT || 4175);
  const mode = args.includes("--record") ? "record" : "offline";
  const srv = createRuntimeMirrorServer({ mode });
  srv.listen(port, "127.0.0.1", () => {
    const { index } = srv.siteRea.cache;
    console.log(`[site-rea] Mirror of ${index.pageUrl} (${index.entries.length} recorded responses, ${mode} mode)`);
    console.log(`[site-rea] Open http://127.0.0.1:${port}/ — unmatched requests are listed at /__rea__/report`);
  });
  if (mode === "record") {
    process.on("SIGINT", () => {
      srv.siteRea.save();
      process.exit(0);
    });
  }
}
