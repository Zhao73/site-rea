import fs from "node:fs";
import path from "node:path";
import { openRuntimeCache, bodyKeyFor, fetchIntoCache, TRACKER_RE } from "./mirror-runtime/server.mjs";

const DROP_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"]);

/**
 * Exact-origin replay: the browser is told that the recording IS the internet.
 * Every request of the context is answered from runtime-cache at the network
 * layer, so the address bar shows the real URL and page code sees its real
 * domain, cookies and origins. Nothing is injected into the page.
 *
 * mode "offline": a request that was not recorded fails, as it would with no network.
 * mode "record":  a request that was not recorded is fetched once and stored.
 */
export async function attachExactReplay(context, cacheDir, { mode = "offline", shared = null } = {}) {
  // `shared` lets several contexts (desktop, mobile) feed one cache and one report.
  const cache = shared?.cache || openRuntimeCache(cacheDir);
  const report =
    (shared && shared.report) ||
    { mode, served: 0, fuzzy: [], misses: [], healed: [], healFailed: [], trackersStubbed: 0, blockedLiveConnections: [] };
  const missSeen = (shared && shared.missSeen) || new Set();

  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    if (!/^https?:/i.test(url)) return route.continue();
    const method = request.method().toUpperCase();
    const reqHeaders = request.headers();
    const origin = reqHeaders.origin;
    const cors = origin
      ? { "access-control-allow-origin": origin, "access-control-allow-credentials": "true" }
      : {};

    try {
      if (method === "OPTIONS") {
        return await route.fulfill({
          status: 204,
          headers: {
            ...cors,
            "access-control-allow-methods": reqHeaders["access-control-request-method"] || "*",
            "access-control-allow-headers": reqHeaders["access-control-request-headers"] || "*",
          },
        });
      }
      if (TRACKER_RE.test(url)) {
        report.trackersStubbed++;
        return await route.fulfill({ status: 204, headers: cors });
      }

      const postData = request.postDataBuffer();
      const bodyKey = bodyKeyFor(postData && postData.length ? postData : null);
      let found = cache.lookup(method, url, bodyKey);
      if ((!found || found.match === "fuzzy") && mode === "record") {
        try {
          const entry = await fetchIntoCache(cache, { method, url, reqHeaders, body: postData });
          if (entry.status !== 0) report.healed.push({ method, url, status: entry.status, bytes: entry.bytes });
          found = { entry, match: "healed" };
        } catch (err) {
          report.healFailed.push({ method, url, error: String(err.message || err) });
        }
      }
      if (!found) {
        const k = `${method} ${url}`;
        if (!missSeen.has(k)) {
          missSeen.add(k);
          report.misses.push({ method, url, dest: request.resourceType() });
        }
        return await route.abort("internetdisconnected");
      }
      if (found.match === "fuzzy" && report.fuzzy.length < 500) {
        report.fuzzy.push({ method, requested: url, served: found.entry.url });
      }

      let entry = found.entry;
      // A redirect answered by the replay is followed by the browser outside of
      // interception, so the chain is resolved here against the recording.
      let currentUrl = url;
      for (let hop = 0; hop < 8 && entry.status >= 300 && entry.status < 400; hop++) {
        const loc = entry.headers.find(([k]) => k.toLowerCase() === "location")?.[1];
        if (!loc) break;
        const target = new URL(loc, currentUrl).href;
        if (request.isNavigationRequest() && request.resourceType() === "document") {
          // A page navigation must end up at the redirected address.
          report.served++;
          return await route.fulfill({
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
            body: `<!doctype html><script>location.replace(${JSON.stringify(target)})</script>`,
          });
        }
        const keepMethod = entry.status === 307 || entry.status === 308;
        const nextMethod = keepMethod ? method : "GET";
        let next = cache.lookup(nextMethod, target, keepMethod ? bodyKey : null);
        if ((!next || next.match === "fuzzy") && mode === "record") {
          try {
            const healed = await fetchIntoCache(cache, { method: nextMethod, url: target, reqHeaders, body: keepMethod ? postData : null });
            if (healed.status !== 0) report.healed.push({ method: nextMethod, url: target, status: healed.status, bytes: healed.bytes });
            next = { entry: healed, match: "healed" };
          } catch (err) {
            report.healFailed.push({ method: nextMethod, url: target, error: String(err.message || err) });
          }
        }
        if (!next) {
          const k = `${nextMethod} ${target}`;
          if (!missSeen.has(k)) {
            missSeen.add(k);
            report.misses.push({ method: nextMethod, url: target, dest: request.resourceType() });
          }
          return await route.abort("internetdisconnected");
        }
        entry = next.entry;
        currentUrl = target;
      }
      if (entry.status === 0) {
        // Unreachable on the real site as well: fail it the same way.
        report.served++;
        return await route.abort("failed");
      }
      const headers = {};
      for (const [k, v] of entry.headers) {
        const name = k.toLowerCase();
        if (DROP_HEADERS.has(name) || name.startsWith(":")) continue;
        // Repeated headers fold into one comma-separated value; Set-Cookie
        // cannot be folded, and Playwright takes its values newline-separated.
        const clean = String(v).replace(/[\r\n]+/g, " ");
        headers[name] = name in headers ? `${headers[name]}${name === "set-cookie" ? "\n" : ", "}${clean}` : clean;
      }
      // Responses fetched while healing were requested without an Origin header.
      if (origin && !headers["access-control-allow-origin"]) Object.assign(headers, cors);

      let status = entry.status;
      let body = entry.file ? fs.readFileSync(path.join(cacheDir, entry.file)) : undefined;
      const range = reqHeaders.range && /^bytes=(\d*)-(\d*)$/.exec(reqHeaders.range);
      if (range && body && entry.status === 200) {
        const size = body.length;
        const start = range[1] === "" ? Math.max(0, size - Number(range[2])) : Number(range[1]);
        const end = range[1] !== "" && range[2] !== "" ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start <= end && start < size) {
          status = 206;
          headers["content-range"] = `bytes ${start}-${end}/${size}`;
          headers["accept-ranges"] = "bytes";
          body = body.subarray(start, end + 1);
        }
      }
      report.served++;
      return await route.fulfill({ status, headers, body });
    } catch (err) {
      // The page went away mid-request (navigation, closed context): nothing to answer.
      await route.abort("failed").catch(() => {});
    }
  });

  // A live socket cannot be replayed; closing it is what offline would do.
  if (typeof context.routeWebSocket === "function") {
    await context.routeWebSocket(/.*/, (ws) => {
      report.blockedLiveConnections.push(ws.url());
      Promise.resolve(ws.close()).catch(() => {});
    });
  }

  return {
    cache,
    report,
    missSeen,
    pageUrl: cache.index.pageUrl,
    resetReport() {
      report.served = 0;
      report.trackersStubbed = 0;
      for (const k of ["fuzzy", "misses", "healed", "healFailed", "blockedLiveConnections"]) report[k].length = 0;
      missSeen.clear();
    },
  };
}
