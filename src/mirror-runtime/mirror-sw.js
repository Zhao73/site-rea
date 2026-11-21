/* Site-REA mirror service worker.
 * Every request made by the mirrored page (same-origin or cross-origin) is
 * answered from the local recording. The response is rebuilt with `new Response`
 * so the page still sees the ORIGINAL url as the response url: relative imports,
 * import.meta.url and CSS url() keep resolving exactly as they did on the real site.
 */
const CFG = self.__REA_CFG__ || {};
const MIRROR = self.location.origin;
const NULL_BODY = new Set([101, 204, 205, 304]);
const FORWARD_HEADERS = ["accept", "content-type", "range", "rsc", "next-router-state-tree", "next-url", "next-router-prefetch", "x-requested-with"];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function originalUrlFor(url) {
  if (url.origin !== MIRROR) return url.href.split("#")[0];
  if (url.pathname.startsWith("/__rea__/fetch/")) {
    const rest = (url.pathname + url.search).slice("/__rea__/fetch/".length);
    const slash = rest.indexOf("/");
    const origin = decodeURIComponent(slash === -1 ? rest : rest.slice(0, slash));
    return origin + (slash === -1 ? "/" : rest.slice(slash));
  }
  return CFG.origin + url.pathname + url.search;
}

function mirrorPathFor(originalUrl) {
  const u = new URL(originalUrl);
  return "/__rea__/fetch/" + encodeURIComponent(u.origin) + u.pathname + u.search;
}

/** Where a navigation to `originalUrl` should land inside the mirror. */
function mirrorNavigationUrl(originalUrl) {
  const u = new URL(originalUrl);
  if (u.origin === CFG.origin) return MIRROR + u.pathname + u.search + u.hash;
  return MIRROR + mirrorPathFor(originalUrl);
}

async function replay(request) {
  const url = new URL(request.url);
  const original = originalUrlFor(url);
  const headers = { "x-rea-sw": "1", "x-rea-dest": request.destination || "" };
  for (const name of FORWARD_HEADERS) {
    const v = request.headers.get(name);
    if (v) headers[name] = v;
  }
  const method = request.method.toUpperCase();
  let body;
  if (method !== "GET" && method !== "HEAD") {
    try {
      body = await request.clone().arrayBuffer();
    } catch {}
  }

  let upstream;
  try {
    upstream = await fetch(mirrorPathFor(original), { method, headers, body, cache: "no-store", credentials: "omit" });
  } catch (err) {
    return new Response("Mirror server unreachable: " + err.message, { status: 502 });
  }

  const recorded = upstream.headers.get("x-rea-status");
  // "0" marks a request that fails on the real site as well (dead host).
  if (recorded === "0") return Response.error();
  const status = Number(recorded || upstream.status) || 200;
  const outHeaders = new Headers();
  upstream.headers.forEach((value, name) => {
    if (name.startsWith("x-rea-")) return;
    outHeaders.set(name, value);
  });

  if (status >= 300 && status < 400) {
    const loc = upstream.headers.get("x-rea-location");
    if (loc) {
      const target = new URL(loc, original).href;
      if (request.mode === "navigate") return Response.redirect(mirrorNavigationUrl(target), 302);
      // The browser follows this and the next hop comes back through the worker.
      outHeaders.set("location", target);
      return new Response(null, { status, headers: outHeaders });
    }
  }
  if (NULL_BODY.has(status) || method === "HEAD") {
    return new Response(null, { status, headers: outHeaders });
  }
  return new Response(upstream.body, { status, headers: outHeaders });
}

self.addEventListener("fetch", (event) => {
  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  // The mirror's own control endpoints go straight to the local server.
  if (url.origin === MIRROR && url.pathname.startsWith("/__rea__/") && !url.pathname.startsWith("/__rea__/fetch/")) return;
  event.respondWith(replay(event.request));
});
