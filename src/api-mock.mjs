import fs from "node:fs";
import path from "node:path";

const SENSITIVE_HEADER_RE = /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token|x-session-token)$/i;
const SENSITIVE_KEY_RE = /(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|session[_-]?id|credit[_-]?card|card[_-]?number|cvv|cvc|ssn|pin)$/i;

export function redactSensitiveObject(val, depth = 0) {
  if (depth > 8 || val === null || val === undefined) return val;
  if (Array.isArray(val)) {
    return val.slice(0, 50).map((item) => redactSensitiveObject(item, depth + 1));
  }
  if (typeof val === "object") {
    const out = {};
    for (const [k, v] of Object.entries(val).slice(0, 100)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactSensitiveObject(v, depth + 1);
      }
    }
    return out;
  }
  if (typeof val === "string" && val.length > 2000) {
    return val.slice(0, 2000) + "...[truncated]";
  }
  return val;
}

export function sanitizeHeaders(headersObj) {
  const out = {};
  for (const [k, v] of Object.entries(headersObj || {})) {
    if (SENSITIVE_HEADER_RE.test(k)) continue;
    out[k.toLowerCase()] = String(v).slice(0, 200);
  }
  return out;
}

export function inferJsonSchema(val, depth = 0) {
  if (depth > 4) return "any";
  if (val === null) return "null";
  if (Array.isArray(val)) {
    if (val.length === 0) return ["any"];
    return [inferJsonSchema(val[0], depth + 1)];
  }
  if (typeof val === "object") {
    const shape = {};
    for (const [k, v] of Object.entries(val).slice(0, 30)) {
      shape[k] = inferJsonSchema(v, depth + 1);
    }
    return shape;
  }
  return typeof val;
}

/**
 * Passively records observed JSON fetch/XHR API contracts with strict credential redaction.
 */
export function attachApiContractCollector(page, { maxRecords = 80, maxBodyBytes = 512 * 1024 } = {}) {
  const records = [];
  const seenKeys = new Set();
  const pending = new Set();

  const onResponse = (response) => {
    try {
      if (records.length >= maxRecords) return;
      const req = response.request();
      const resType = req.resourceType();
      if (resType !== "fetch" && resType !== "xhr") return;

      const status = response.status();
      if (status < 200 || status >= 400) return;

      const urlStr = response.url();
      const headers = response.headers();
      const ct = (headers["content-type"] || "").toLowerCase();
      if (!ct.includes("application/json") && !ct.includes("+json")) return;

      const method = req.method().toUpperCase();
      let parsedUrl;
      try {
        parsedUrl = new URL(urlStr);
      } catch {
        return;
      }

      const dedupeKey = `${method} ${parsedUrl.origin}${parsedUrl.pathname}`;
      if (seenKeys.has(dedupeKey)) return;
      seenKeys.add(dedupeKey);

      const task = response
        .body()
        .then((buf) => {
          if (!buf || buf.length === 0 || buf.length > maxBodyBytes) return;
          let jsonBody;
          try {
            jsonBody = JSON.parse(buf.toString("utf8"));
          } catch {
            return;
          }

          let reqJson = null;
          const postData = req.postData();
          if (postData) {
            try {
              reqJson = redactSensitiveObject(JSON.parse(postData));
            } catch {
              reqJson = "[non-json-body]";
            }
          }

          const sanitizedResp = redactSensitiveObject(jsonBody);
          records.push({
            method,
            origin: parsedUrl.origin,
            pathname: parsedUrl.pathname,
            queryKeys: Array.from(parsedUrl.searchParams.keys()),
            status,
            requestSchema: reqJson && typeof reqJson === "object" ? inferJsonSchema(reqJson) : null,
            responseSchema: inferJsonSchema(sanitizedResp),
            sampleResponse: sanitizedResp,
          });
        })
        .catch(() => {})
        .finally(() => pending.delete(task));

      pending.add(task);
    } catch {}
  };

  page.on("response", onResponse);

  return {
    records,
    async flush() {
      page.off("response", onResponse);
      await Promise.allSettled(Array.from(pending));
      return records;
    },
  };
}

export function saveApiContracts(evidenceDir, contracts) {
  const payload = {
    recordedAt: new Date().toISOString(),
    redactionApplied: true,
    totalEndpoints: contracts.length,
    endpoints: contracts,
  };
  const outPath = path.join(evidenceDir, "api-contracts.json");
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  return outPath;
}

/**
 * Generates a runnable zero-dependency local stateful Mock API Server + client fetch bridge
 * from recorded sanitized api-contracts.json so cloned SaaS frontends work interactively offline.
 */
export function scaffoldMockBackend({ evidenceDir, targetDir, port = 4174 }) {
  const resolvedEvidence = path.resolve(evidenceDir);
  const resolvedTarget = path.resolve(targetDir);
  const contractsPath = path.join(resolvedEvidence, "api-contracts.json");

  let contracts = { endpoints: [] };
  if (fs.existsSync(contractsPath)) {
    contracts = JSON.parse(fs.readFileSync(contractsPath, "utf8"));
  }

  const mockDir = path.join(resolvedTarget, "mock-backend");
  fs.mkdirSync(mockDir, { recursive: true });

  const fixtures = {};
  const recordedOrigins = new Set();
  for (const ep of contracts.endpoints || []) {
    if (ep.origin) recordedOrigins.add(ep.origin);
    const key = `${ep.method || "GET"} ${ep.pathname}`;
    fixtures[key] = {
      status: ep.status || 200,
      pathname: ep.pathname,
      method: ep.method || "GET",
      data: ep.sampleResponse,
    };
  }

  fs.writeFileSync(path.join(mockDir, "fixtures.json"), JSON.stringify(fixtures, null, 2) + "\n", "utf8");

  const serverCode = `#!/usr/bin/env node
/**
 * Site-REA Local Stateful Mock Backend Sandbox
 * Auto-generated from sanitized api-contracts.json.
 * Supports GET replay + stateful POST/PUT/PATCH/DELETE persisted in state.json
 * plus local-only demo auth state (/api/__mock_auth/*).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MOCK_PORT || ${Number(port) || 4174});
const FIXTURES_PATH = path.join(__dirname, "fixtures.json");
const STATE_PATH = path.join(__dirname, "state.json");

const fixtures = JSON.parse(fs.readFileSync(FIXTURES_PATH, "utf8"));

function loadState() {
  if (fs.existsSync(STATE_PATH)) {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch {}
  }
  const initial = { collections: {}, demoUser: null };
  for (const entry of Object.values(fixtures)) {
    if (entry.method === "GET") {
      initial.collections[entry.pathname] = structuredClone(entry.data);
    }
  }
  return initial;
}

let state = loadState();
function saveState() {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (!raw) return resolve(null);
      try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    });
    res.end();
    return;
  }

  const u = new URL(req.url || "/", \`http://127.0.0.1:\${PORT}\`);
  const pathname = u.pathname;
  const method = (req.method || "GET").toUpperCase();

  // Built-in local sandbox demo auth endpoints (local testing only)
  if (pathname === "/api/__mock_auth/login" && method === "POST") {
    const body = (await readBody(req)) || {};
    state.demoUser = { id: "local-demo-user", name: body.name || "Demo User", role: body.role || "member" };
    saveState();
    return sendJson(res, 200, { ok: true, user: state.demoUser });
  }
  if (pathname === "/api/__mock_auth/logout" && method === "POST") {
    state.demoUser = null;
    saveState();
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === "/api/__mock_auth/me" && method === "GET") {
    return sendJson(res, 200, { authenticated: Boolean(state.demoUser), user: state.demoUser });
  }
  if (pathname === "/api/__mock_reset" && method === "POST") {
    if (fs.existsSync(STATE_PATH)) fs.unlinkSync(STATE_PATH);
    state = loadState();
    return sendJson(res, 200, { ok: true, reset: true });
  }

  // Exact GET match from stateful collections
  if (method === "GET" && pathname in state.collections) {
    return sendJson(res, 200, state.collections[pathname]);
  }

  // Exact method+pathname fixture match
  const exactKey = \`\${method} \${pathname}\`;
  if (method === "GET" && fixtures[exactKey]) {
    return sendJson(res, fixtures[exactKey].status || 200, fixtures[exactKey].data);
  }

  // Stateful POST to a collection path
  if (method === "POST") {
    const body = (await readBody(req)) || {};
    const created = typeof body === "object" && body !== null
      ? { id: body.id || \`mock-\${Date.now()}\`, ...body }
      : { id: \`mock-\${Date.now()}\`, value: body };

    if (Array.isArray(state.collections[pathname])) {
      state.collections[pathname].push(created);
      saveState();
      return sendJson(res, 201, created);
    }
    if (state.collections[pathname] && Array.isArray(state.collections[pathname].items)) {
      state.collections[pathname].items.push(created);
      saveState();
      return sendJson(res, 201, created);
    }
    if (fixtures[exactKey]) {
      return sendJson(res, fixtures[exactKey].status || 200, fixtures[exactKey].data);
    }
    state.collections[pathname] = [created];
    saveState();
    return sendJson(res, 201, created);
  }

  // Stateful PUT/PATCH/DELETE on /collection/:id
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length >= 2 && ["PUT", "PATCH", "DELETE"].includes(method)) {
    const itemId = segments[segments.length - 1];
    const parentPath = "/" + segments.slice(0, -1).join("/");
    const target = state.collections[parentPath];
    const list = Array.isArray(target) ? target : Array.isArray(target?.items) ? target.items : null;

    if (list) {
      const idx = list.findIndex((it) => String(it?.id) === String(itemId));
      if (idx === -1) return sendJson(res, 404, { error: "Item not found", id: itemId });
      if (method === "DELETE") {
        const [removed] = list.splice(idx, 1);
        saveState();
        return sendJson(res, 200, { deleted: true, item: removed });
      }
      const patch = (await readBody(req)) || {};
      list[idx] = { ...list[idx], ...(typeof patch === "object" ? patch : {}) };
      saveState();
      return sendJson(res, 200, list[idx]);
    }
  }

  return sendJson(res, 404, {
    error: "No mock fixture registered for this endpoint",
    method,
    pathname,
    registeredEndpoints: Object.keys(fixtures),
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(\`[site-rea mock-backend] Listening on http://127.0.0.1:\${PORT} (\${Object.keys(fixtures).length} recorded endpoints)\`);
});
`;

  const serverPath = path.join(mockDir, "server.mjs");
  fs.writeFileSync(serverPath, serverCode, "utf8");

  // Client fetch bridge so cloned frontend transparently routes recorded API origins to local mock server
  const bridgeCode = `// Include before app scripts to route recorded API calls to the local Site-REA Mock Backend
(() => {
  const MOCK_BASE = window.__SITE_REA_MOCK_BASE__ || "http://127.0.0.1:${Number(port) || 4174}";
  const RECORDED_ORIGINS = ${JSON.stringify(Array.from(recordedOrigins))};
  const RECORDED_PATHS = ${JSON.stringify(Array.from(new Set((contracts.endpoints || []).map((e) => e.pathname))))};
  const origFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    try {
      const rawUrl = typeof input === "string" ? input : input?.url;
      if (rawUrl) {
        const parsed = new URL(rawUrl, location.href);
        const shouldRoute =
          RECORDED_ORIGINS.includes(parsed.origin) ||
          RECORDED_PATHS.some((p) => parsed.pathname === p || parsed.pathname.startsWith(p + "/"));
        if (shouldRoute) {
          const redirected = MOCK_BASE + parsed.pathname + parsed.search;
          return origFetch(redirected, init);
        }
      }
    } catch {}
    return origFetch(input, init);
  };
})();
`;

  const bridgePath = path.join(mockDir, "mock-fetch-bridge.js");
  fs.writeFileSync(bridgePath, bridgeCode, "utf8");

  return {
    status: "ok",
    mockDir,
    serverPath,
    fixturesPath: path.join(mockDir, "fixtures.json"),
    bridgePath,
    port: Number(port) || 4174,
    endpointCount: Object.keys(fixtures).length,
    endpoints: Object.keys(fixtures),
    startCommand: `node "${serverPath}"`,
  };
}
