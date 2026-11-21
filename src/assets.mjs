import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const EXT_FROM_MIME = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/avif": ".avif",
  "image/x-icon": ".ico",
  "image/vnd.microsoft.icon": ".ico",
  "font/woff2": ".woff2",
  "font/woff": ".woff",
  "font/ttf": ".ttf",
  "font/otf": ".otf",
  "application/font-woff2": ".woff2",
  "application/font-woff": ".woff",
  "application/vnd.ms-fontobject": ".eot",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "model/gltf-binary": ".glb",
  "model/gltf+json": ".gltf",
  "application/wasm": ".wasm",
  "application/json": ".json",
};

function sanitizeExt(urlStr, contentType) {
  const mime = (contentType || "").split(";")[0].trim().toLowerCase();
  if (EXT_FROM_MIME[mime]) return EXT_FROM_MIME[mime];
  try {
    const pathname = new URL(urlStr).pathname;
    const ext = path.extname(pathname).toLowerCase();
    if (ext && ext.length <= 6 && /^\.[a-z0-9]+$/.test(ext)) {
      return ext;
    }
  } catch {}
  return ".bin";
}

function hashUrl(urlStr) {
  return crypto.createHash("sha256").update(urlStr).digest("hex").slice(0, 12);
}

function inferTypeFromMime(contentType, resourceType, urlStr) {
  const ct = (contentType || "").toLowerCase();
  if (resourceType === "lottie" || /\.lottie(\?|$)/i.test(urlStr)) {
    return "lottie";
  }
  if (
    ct.startsWith("model/") ||
    /\.(glb|gltf|bin|hdr|exr|ktx2|dds|basis|drc|obj|mtl|fbx|stl|ply|usdz|splat|spz|splinecode)(\?|$)/i.test(urlStr)
  ) {
    return "model";
  }
  if (/\.(wgsl|glsl|vert|frag)(\?|$)/i.test(urlStr)) {
    return "shader";
  }
  if (ct.includes("wasm") || /\.wasm(\?|$)/i.test(urlStr)) {
    return "wasm";
  }
  if (resourceType === "font" || ct.startsWith("font/") || ct.includes("woff") || /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(urlStr)) {
    return "font";
  }
  if (ct.startsWith("video/") || /\.(mp4|webm)(\?|$)/i.test(urlStr)) {
    return "video";
  }
  return "image";
}

function subdirForType(type) {
  if (type === "font") return "fonts";
  if (type === "video") return "videos";
  if (type === "svg") return "svgs";
  if (type === "model") return "models";
  if (type === "shader") return "shaders";
  if (type === "lottie") return "lottie";
  if (type === "wasm") return "wasm";
  return "images";
}

async function fetchWithTimeout(url, { timeoutMs = 12000, maxBytes = 15 * 1024 * 1024, referer } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "*/*",
    };
    if (referer) headers.Referer = referer;
    const res = await fetch(url, { signal: controller.signal, headers, redirect: "follow" });
    if (!res.ok) {
      return { ok: false, status: res.status };
    }
    const contentLength = Number(res.headers.get("content-length") || "0");
    if (contentLength > maxBytes) {
      return { ok: false, status: 413, reason: `exceeds ${maxBytes} bytes` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      return { ok: false, status: 413, reason: `exceeds ${maxBytes} bytes` };
    }
    return {
      ok: true,
      status: res.status,
      contentType: res.headers.get("content-type") || "",
      buffer: buf,
    };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function downloadAndSaveAssets({
  assets,
  inlineSvgs,
  capturedResources,
  evidenceDir,
  pageUrl,
  downloadEnabled = true,
  allowRemoteFetch = true,
  concurrency = 8,
  maxAssets = 280,
}) {
  const assetsDir = path.join(evidenceDir, "assets");
  const subdirs = ["images", "svgs", "fonts", "videos", "models", "shaders", "lottie", "wasm"];
  for (const sub of subdirs) {
    fs.mkdirSync(path.join(assetsDir, sub), { recursive: true });
  }

  const manifest = [];
  const urlToRelPath = new Map();

  const saveBufferAsset = (url, type, buffer, contentType, extra = {}) => {
    if (urlToRelPath.has(url)) return urlToRelPath.get(url);
    const ext = sanitizeExt(url, contentType);
    const sub = subdirForType(type);
    const filename = `${sub.slice(0, -1)}-${hashUrl(url)}${ext}`;
    const relPath = `assets/${sub}/${filename}`;
    const absPath = path.join(evidenceDir, relPath);
    fs.writeFileSync(absPath, buffer);
    urlToRelPath.set(url, relPath);

    manifest.push({
      type,
      originalUrl: url,
      downloaded: true,
      localPath: relPath,
      absPath,
      bytes: buffer.length,
      mimeType: (contentType || "").split(";")[0].trim(),
      ...extra,
    });
    return relPath;
  };

  // 1. Save inline SVGs locally
  for (const svg of inlineSvgs || []) {
    const relPath = `assets/svgs/${svg.id}.svg`;
    const absPath = path.join(evidenceDir, relPath);
    fs.writeFileSync(absPath, svg.markup, "utf8");
    manifest.push({
      id: svg.id,
      type: "svg",
      source: "inline",
      localPath: relPath,
      absPath,
      width: svg.width,
      height: svg.height,
      color: svg.color,
      usedInSections: [svg.sectionIndex],
    });
  }

  // Build metadata map from DOM-extracted assets
  const domMetaByUrl = new Map();
  for (const item of assets || []) {
    if (item.url && !domMetaByUrl.has(item.url)) {
      domMetaByUrl.set(item.url, item);
    }
  }

  if (downloadEnabled) {
    // 2. First persist all live browser-intercepted images & fonts (zero hotlink/CORS failure!)
    if (capturedResources && capturedResources.size > 0) {
      for (const [url, rec] of capturedResources.entries()) {
        if (rec.resourceType === "stylesheet" || (rec.contentType || "").includes("text/css")) continue;
        if (urlToRelPath.size >= maxAssets) break;
        const meta = domMetaByUrl.get(url);
        const type = meta?.type || inferTypeFromMime(rec.contentType, rec.resourceType, url);
        saveBufferAsset(url, type, rec.buffer, rec.contentType, {
          source: "browser-network",
          alt: meta?.alt || undefined,
          role: meta?.role || undefined,
          width: meta?.naturalWidth || undefined,
          height: meta?.naturalHeight || undefined,
          usedInSections: meta?.usedInSections || [],
        });
      }
    }

    // 3. Fallback fetch for any DOM-referenced asset not already captured from network
    const remaining = allowRemoteFetch
      ? (assets || []).filter((item) => item.url && !urlToRelPath.has(item.url)).slice(0, maxAssets)
      : [];
    let cursor = 0;

    async function worker() {
      while (cursor < remaining.length) {
        const idx = cursor++;
        const item = remaining[idx];
        if (!item.url || urlToRelPath.has(item.url)) continue;

        const fetched = await fetchWithTimeout(item.url, {
          referer: pageUrl,
          maxBytes: item.type === "video" ? 20 * 1024 * 1024 : 10 * 1024 * 1024,
        });
        if (!fetched.ok || !fetched.buffer || fetched.buffer.length === 0) {
          manifest.push({
            type: item.type,
            originalUrl: item.url,
            downloaded: false,
            error: fetched.reason || fetched.error || `HTTP ${fetched.status}`,
            usedInSections: item.usedInSections || [],
          });
          continue;
        }

        saveBufferAsset(item.url, item.type, fetched.buffer, fetched.contentType, {
          source: "direct-fetch",
          alt: item.alt || undefined,
          role: item.role || undefined,
          width: item.naturalWidth || undefined,
          height: item.naturalHeight || undefined,
          usedInSections: item.usedInSections || [],
        });
      }
    }

    if (remaining.length > 0) {
      const workers = Array.from({ length: Math.min(concurrency, remaining.length) }, () => worker());
      await Promise.all(workers);
    }
  }

  return { manifest, urlToRelPath, saveBufferAsset };
}

export function rewriteBlueprintWithLocalAssets(blueprint, urlToRelPath) {
  function patchNode(node) {
    if (!node || typeof node !== "object") return;
    if (node.src && urlToRelPath.has(node.src)) {
      node.localSrc = urlToRelPath.get(node.src);
    }
    if (node.poster && urlToRelPath.has(node.poster)) {
      node.localPoster = urlToRelPath.get(node.poster);
    }
    if (node.svgId) {
      node.localSvg = `assets/svgs/${node.svgId}.svg`;
    }
    if (Array.isArray(node.backgroundUrls)) {
      node.localBackgrounds = node.backgroundUrls
        .map((u) => urlToRelPath.get(u))
        .filter(Boolean);
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) patchNode(child);
    }
  }
  for (const sec of blueprint.sections || []) {
    patchNode(sec.tree);
  }
}

async function resolveStylesheetText(href, capturedResources, pageUrl, visited, depth = 0, allowRemoteFetch = true) {
  if (!href || visited.has(href) || depth > 2) return "";
  visited.add(href);

  let cssText = "";
  const cached = capturedResources?.get(href);
  if (cached && cached.buffer) {
    cssText = cached.buffer.toString("utf8");
  } else if (allowRemoteFetch) {
    const fetched = await fetchWithTimeout(href, { referer: pageUrl, maxBytes: 5 * 1024 * 1024 });
    if (fetched.ok && fetched.buffer) {
      cssText = fetched.buffer.toString("utf8");
    }
  }
  if (!cssText) return "";

  // Recursively inline @import statements
  const importRegex = /@import\s+(?:url\(\s*)?['"]?([^'")\s]+)['"]?\s*\)?([^;]*);/gi;
  const replacements = [];
  let match;
  while ((match = importRegex.exec(cssText)) !== null) {
    try {
      const importUrl = new URL(match[1], href).href;
      const nested = await resolveStylesheetText(importUrl, capturedResources, href, visited, depth + 1, allowRemoteFetch);
      replacements.push({ full: match[0], nested });
    } catch {}
  }
  for (const rep of replacements) {
    cssText = cssText.replace(rep.full, rep.nested ? `/* @import inlined */\n${rep.nested}` : "");
  }
  return cssText;
}

export async function buildOfflineMirror({
  mirrorPayload,
  capturedResources,
  evidenceDir,
  urlToRelPath,
  saveBufferAsset,
  pageUrl,
  allowRemoteFetch = true,
}) {
  const mirrorDir = path.join(evidenceDir, "mirror");
  fs.mkdirSync(mirrorDir, { recursive: true });

  const visitedSheets = new Set();
  const cssParts = [];

  for (const chunk of mirrorPayload.cssChunks || []) {
    if (chunk.kind === "inline") {
      cssParts.push(
        await localizeCssChunk(chunk.cssText, chunk.href || pageUrl, urlToRelPath, saveBufferAsset, pageUrl, allowRemoteFetch)
      );
      continue;
    }
    // A sheet the page could not read itself (cross-origin): take it from the
    // recorded responses and put it where it stood in the cascade.
    const rawCss = await resolveStylesheetText(chunk.href, capturedResources, pageUrl, visitedSheets, 0, allowRemoteFetch);
    if (rawCss.trim()) {
      const localized = await localizeCssChunk(rawCss, chunk.href, urlToRelPath, saveBufferAsset, pageUrl, allowRemoteFetch);
      const scoped = chunk.media && chunk.media !== "all" ? `@media ${chunk.media} {\n${localized}\n}` : localized;
      cssParts.push(`/* ${chunk.href} */\n${scoped}`);
    }
  }

  const combinedCss = cssParts.join("\n\n");
  fs.writeFileSync(path.join(mirrorDir, "styles.css"), combinedCss, "utf8");

  // Rewrite asset URLs inside the HTML (longest URL first to avoid substring collisions)
  let html = mirrorPayload.html || "";
  const sortedEntries = Array.from(urlToRelPath.entries()).sort((a, b) => b[0].length - a[0].length);
  for (const [origUrl, relPath] of sortedEntries) {
    const localRef = `../${relPath}`;
    html = html.split(origUrl).join(localRef);
    if (origUrl.includes("&")) {
      html = html.split(origUrl.replace(/&/g, "&amp;")).join(localRef);
    }
  }

  // Inject our consolidated local stylesheet right before </head>
  const styleLinkTag = `<link rel="stylesheet" href="./styles.css" />`;
  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `  ${styleLinkTag}\n</head>`);
  } else {
    html = `<head>${styleLinkTag}</head>\n${html}`;
  }

  const finalHtml = `${mirrorPayload.doctype || "<!DOCTYPE html>"}\n${html}`;
  const mirrorHtmlPath = path.join(mirrorDir, "index.html");
  fs.writeFileSync(mirrorHtmlPath, finalHtml, "utf8");

  return {
    mirrorDir,
    mirrorHtmlPath,
    mirrorCssPath: path.join(mirrorDir, "styles.css"),
    cssBytes: Buffer.byteLength(combinedCss, "utf8"),
    htmlBytes: Buffer.byteLength(finalHtml, "utf8"),
  };
}

async function localizeCssChunk(cssText, baseHref, urlToRelPath, saveBufferAsset, pageUrl, allowRemoteFetch = true) {
  // Discover any un-localized url(...) inside CSS (e.g., fonts or background images from CORS stylesheets)
  const urlsToFetch = new Set();
  const regex = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let m;
  while ((m = regex.exec(cssText)) !== null) {
    const raw = (m[2] || "").trim();
    if (!raw || raw.startsWith("data:") || raw.startsWith("#")) continue;
    try {
      const resolved = new URL(raw, baseHref).href;
      if (resolved.startsWith("http") && !urlToRelPath.has(resolved)) {
        urlsToFetch.add(resolved);
      }
    } catch {}
  }

  if (allowRemoteFetch && saveBufferAsset && urlsToFetch.size > 0) {
    const list = Array.from(urlsToFetch).slice(0, 60);
    await Promise.allSettled(
      list.map(async (u) => {
        const res = await fetchWithTimeout(u, { referer: pageUrl, timeoutMs: 8000, maxBytes: 8 * 1024 * 1024 });
        if (res.ok && res.buffer && res.buffer.length > 0) {
          const type = inferTypeFromMime(res.contentType, "", u);
          saveBufferAsset(u, type, res.buffer, res.contentType, { source: "css-discovered", usedInSections: [] });
        }
      })
    );
  }

  return cssText.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (full, quote, rawUrl) => {
    const trimmed = (rawUrl || "").trim();
    if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("#")) return full;
    try {
      const resolved = new URL(trimmed, baseHref).href;
      if (urlToRelPath.has(resolved)) {
        return `url("../${urlToRelPath.get(resolved)}")`;
      }
      return `url("${resolved}")`;
    } catch {
      return full;
    }
  });
}
