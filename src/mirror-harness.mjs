import http from "node:http";
import net from "node:net";
import { scrollAndSettlePage } from "./browser.mjs";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
// Requests Chrome itself makes (autofill models, component updates, safe browsing).
// They are not the page's doing, so they are refused but not counted against it.
const BROWSER_INTERNAL_RE =
  /(^|\.)(content-autofill\.googleapis\.com|optimizationguide-pa\.googleapis\.com|update\.googleapis\.com|safebrowsing\.googleapis\.com|clientservices\.googleapis\.com|accounts\.google\.com|clients\d*\.google\.com|gvt1\.com|gvt2\.com|edge\.microsoft\.com|msedge\.net)$/i;

/**
 * A proxy that refuses everything except loopback. A browser context pointed at
 * it has no route to the internet, and every attempt to reach one is recorded:
 * this is what makes "it runs offline" a measured fact instead of a claim.
 */
export function startBlackholeProxy() {
  const attempts = [];
  const server = http.createServer((req, res) => {
    let target;
    try {
      target = new URL(req.url);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (!LOOPBACK.has(target.hostname)) {
      if (!BROWSER_INTERNAL_RE.test(target.hostname)) attempts.push(`${req.method} ${target.href}`);
      res.writeHead(502, { "content-type": "text/plain" });
      res.end("site-rea: external network is blocked");
      return;
    }
    const headers = { ...req.headers };
    delete headers["proxy-connection"];
    const upstream = http.request(
      { host: "127.0.0.1", port: target.port || 80, method: req.method, path: target.pathname + target.search, headers },
      (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
      }
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  server.on("connect", (req, socket) => {
    const [host, port] = String(req.url || "").split(":");
    if (!LOOPBACK.has(host)) {
      if (!BROWSER_INTERNAL_RE.test(host)) attempts.push(`CONNECT ${req.url}`);
      socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      return;
    }
    const up = net.connect(Number(port) || 80, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        attempts,
        proxy: { server: `http://127.0.0.1:${port}` },
        close: () =>
          new Promise((r) => {
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}

export function listenEphemeral(server) {
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

export function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

/**
 * Opens a page that may be a runtime mirror. A mirror answers the first visit
 * with a bootstrap page that installs the service worker and reloads, so the
 * navigation is only done once the real document is in control.
 */
export async function gotoSettled(page, url, { timeoutMs = 45000 } = {}) {
  let response;
  try {
    response = await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
  } catch {
    response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  }
  const isBootstrap = await page
    .evaluate(() => Boolean(document.querySelector("#m")) && document.title.startsWith("Loading mirror"))
    .catch(() => true);
  if (isBootstrap) {
    await page
      .waitForFunction(() => self.__SITE_REA_MIRROR__ && self.__SITE_REA_MIRROR__.ready === true, null, { timeout: timeoutMs })
      .catch(() => {});
    await page.waitForLoadState("load", { timeout: timeoutMs }).catch(() => {});
  }
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  return response;
}

/**
 * Walks the page the way a visitor would so lazily loaded code and media are
 * requested: scroll through everything, then hover the navigation (frameworks
 * prefetch route chunks on hover, menus load their panels).
 */
export async function exercisePage(page, { waitMs = 900, hover = true } = {}) {
  await scrollAndSettlePage(page, { waitMs });
  if (hover) {
    const points = await page
      .evaluate(() => {
        const out = [];
        const seen = new Set();
        const els = document.querySelectorAll(
          "header a, header button, nav a, nav button, [role='menuitem'], [aria-haspopup], [role='tab']"
        );
        for (const el of els) {
          const r = el.getBoundingClientRect();
          if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
          const key = `${Math.round(r.left)}:${Math.round(r.top)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
          if (out.length >= 40) break;
        }
        return out;
      })
      .catch(() => []);
    for (const p of points) {
      await page.mouse.move(p.x, p.y).catch(() => {});
      await page.waitForTimeout(70);
    }
    await page.mouse.move(1, 1).catch(() => {});
  }
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
}

/** Every URL the DOM could ask for later: other srcset widths, unplayed media, preloads. */
export async function collectDomResourceUrls(page) {
  return await page
    .evaluate(() => {
      const urls = new Set();
      const add = (raw) => {
        if (!raw) return;
        const v = String(raw).trim();
        if (!v || v.startsWith("data:") || v.startsWith("blob:") || v.startsWith("#") || v.startsWith("javascript:")) return;
        try {
          const u = new URL(v, document.baseURI);
          if (u.protocol === "http:" || u.protocol === "https:") urls.add(u.href.split("#")[0]);
        } catch {}
      };
      const addSrcset = (raw) => {
        if (!raw) return;
        for (const part of String(raw).split(",")) add(part.trim().split(/\s+/)[0]);
      };
      for (const el of document.querySelectorAll("img, source, video, audio, track, embed, input[type='image']")) {
        add(el.getAttribute("src"));
        addSrcset(el.getAttribute("srcset"));
        add(el.getAttribute("poster"));
        add(el.getAttribute("data-src"));
        addSrcset(el.getAttribute("data-srcset"));
      }
      for (const el of document.querySelectorAll(
        "link[rel~='preload'], link[rel~='modulepreload'], link[rel~='prefetch'], link[rel~='icon'], link[rel~='apple-touch-icon'], link[rel~='manifest'], link[rel~='stylesheet']"
      )) {
        add(el.getAttribute("href"));
        addSrcset(el.getAttribute("imagesrcset"));
      }
      for (const el of document.querySelectorAll("script[src]")) add(el.getAttribute("src"));
      for (const el of document.querySelectorAll("object[data]")) add(el.getAttribute("data"));
      for (const el of document.querySelectorAll("use")) {
        const href = el.getAttribute("href") || el.getAttribute("xlink:href");
        if (href && !href.startsWith("#")) add(href);
      }
      return Array.from(urls);
    })
    .catch(() => []);
}
