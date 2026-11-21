// Runtime-mirror and code-generation tests against a site built to be awkward:
// assets on a second origin, a chunk imported only after scrolling, a POST API,
// a redirect, a print stylesheet, @import. The "live" servers are shut down
// before verification, so anything not served from the recording fails.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { build } from "esbuild";
import { captureSite } from "../src/capture.mjs";
import { scaffoldProject } from "../src/scaffold.mjs";
import { verifyClone } from "../src/verify.mjs";
import { openMirror } from "../src/open-mirror.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "site-rea-mirror-"));
const evidenceDir = path.join(tmpRoot, "evidence");

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${srv.address().port}`,
        close: () =>
          new Promise((r) => {
            srv.closeAllConnections?.();
            srv.close(() => r());
          }),
      })
    );
  });
}

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function startSite() {
  // Second origin: the "CDN" holding scripts, styles and an image.
  const cdn = await listen((req, res) => {
    const cors = { "access-control-allow-origin": "*" };
    if (req.url === "/app.js") {
      res.writeHead(200, { "content-type": "text/javascript", ...cors });
      res.end(`
        // Loaded only once the marker scrolls into view: a lazily imported chunk.
        const io = new IntersectionObserver(async (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          io.disconnect();
          const mod = await import("./chunks/late.js");
          document.getElementById("late").textContent = mod.message;
        });
        io.observe(document.getElementById("late"));
        fetch("/api/items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ page: 1 }) })
          .then((r) => r.json())
          .then((data) => { document.getElementById("items").textContent = data.items.join(", "); });
      `);
      return;
    }
    if (req.url === "/chunks/late.js") {
      res.writeHead(200, { "content-type": "text/javascript", ...cors });
      res.end(`export const message = "Late chunk loaded";`);
      return;
    }
    if (req.url === "/theme.css") {
      res.writeHead(200, { "content-type": "text/css", ...cors });
      res.end(`@import url("./base.css");\n.card { background: #0f766e; color: #fff; padding: 32px; border-radius: 16px; }`);
      return;
    }
    if (req.url === "/base.css") {
      res.writeHead(200, { "content-type": "text/css", ...cors });
      res.end(`body { margin: 0; font-family: system-ui, sans-serif; background: #f8fafc; color: #0f172a; }\nh1 { font-size: 56px; margin: 0; padding: 80px 48px 24px; }`);
      return;
    }
    if (req.url === "/print.css") {
      res.writeHead(200, { "content-type": "text/css", ...cors });
      // Applied to the screen by mistake, this would hide the whole page.
      res.end(`body { display: none; }`);
      return;
    }
    if (req.url === "/pixel.png") {
      res.writeHead(200, { "content-type": "image/png", ...cors });
      res.end(PNG_1PX);
      return;
    }
    res.writeHead(404, cors);
    res.end();
  });

  const site = await listen((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Mirror fixture</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${cdn.url}/theme.css">
<link rel="stylesheet" media="print" href="${cdn.url}/print.css">
</head><body>
<header><h1>Offline replay fixture</h1></header>
<main>
  <section class="card" style="margin: 0 48px"><h2>Items</h2><p id="items">loading</p>
    <img src="/redirected.png" width="40" height="40" alt="redirected"></section>
  <section style="height: 1800px; padding: 48px"><h2>Spacer</h2></section>
  <section class="card" style="margin: 0 48px 48px"><h2>Lazy part</h2><p id="late">waiting</p></section>
</main>
<footer style="padding: 24px 48px">Footer text</footer>
<script type="module" src="${cdn.url}/app.js"></script>
</body></html>`);
      return;
    }
    if (req.url === "/api/items" && req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ items: ["alpha", "beta", "gamma"] }));
      return;
    }
    if (req.url === "/redirected.png") {
      res.writeHead(302, { location: `${cdn.url}/pixel.png` });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return { site, cdn };
}

async function run() {
  const { site, cdn } = await startSite();
  let stopped = false;
  const stopLive = async () => {
    if (stopped) return;
    stopped = true;
    await site.close();
    await cdn.close();
  };

  try {
    console.log("1. Capturing (record both viewports, rehearse offline, fill what is missing)...");
    const cap = await captureSite({ url: site.url, outputDir: evidenceDir, deterministic: true, waitMs: 300 });
    assert.equal(cap.status, "ok");
    assert.ok(cap.runtimeCache.rehearsal, "Expected a rehearsal report");
    assert.equal(cap.runtimeCache.rehearsal.unresolvedCount, 0, JSON.stringify(cap.runtimeCache.rehearsal.unresolved));
    const index = JSON.parse(fs.readFileSync(cap.runtimeCache.indexPath, "utf8"));
    const recorded = (suffix, method = "GET") => index.entries.some((e) => e.method === method && e.url.endsWith(suffix));
    assert.ok(recorded("/chunks/late.js"), "The lazily imported chunk must be in the recording");
    assert.ok(recorded("/api/items", "POST"), "The POST response must be in the recording");
    assert.ok(index.entries.some((e) => e.status === 302), "The redirect must be recorded as a redirect");
    for (const sec of cap.sectionsIndex) {
      assert.ok(sec.screenshot && fs.existsSync(sec.screenshot), `Section ${sec.index} has no screenshot`);
    }
    assert.ok(!cap.warnings.some((w) => /screenshot failed/i.test(w)), JSON.stringify(cap.warnings));

    console.log("2. Shutting the live servers down; from here only the recording exists.");
    await stopLive();

    console.log("3. runtime-mirror: exact-origin replay and the portable server, both offline...");
    const mirrorDir = path.join(tmpRoot, "runtime-mirror");
    scaffoldProject({ evidenceDir, targetDir: mirrorDir, mode: "runtime-mirror" });
    for (const f of ["server.mjs", "mirror-sw.js", "mirror-prelude.js", "runtime-cache/index.json"]) {
      assert.ok(fs.existsSync(path.join(mirrorDir, f)), `runtime-mirror project lacks ${f}`);
    }
    const ver = await verifyClone({ evidenceDir, cloneDir: mirrorDir, waitMs: 300 });
    for (const modeName of ["exact", "portable"]) {
      const mode = ver.replayModes[modeName];
      assert.ok(mode, `Missing ${modeName} replay result`);
      assert.equal(mode.offline.cacheMisses, 0, `${modeName}: ${JSON.stringify(mode.offline.misses)}`);
      assert.equal(mode.offline.passed, true, `${modeName}: ${JSON.stringify(mode.issues)}`);
      assert.equal(mode.healthy, true, `${modeName}: ${JSON.stringify(mode.issues)}`);
      for (const vp of ["desktop", "mobile"]) {
        assert.ok(
          mode.results[vp].fullDiff.similarityPct >= 99.5,
          `${modeName} ${vp} full-page similarity ${mode.results[vp].fullDiff.similarityPct}%`
        );
      }
    }
    assert.equal(ver.replayModes.portable.offline.externalRequestsBlocked, 0);

    console.log("4. `open`: the recording under its real address, scripts running...");
    await openMirror({
      dir: mirrorDir,
      headless: true,
      onReady: async ({ page, replay, close }) => {
        try {
          assert.equal(new URL(page.url()).origin, new URL(site.url).origin, "Address must be the original one");
          await page.waitForFunction(() => document.getElementById("items").textContent.includes("alpha"), null, { timeout: 10000 });
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await page.waitForFunction(() => document.getElementById("late").textContent === "Late chunk loaded", null, { timeout: 10000 });
          assert.equal(replay.report.misses.length, 0, JSON.stringify(replay.report.misses));
        } finally {
          await close();
        }
      },
    });

    console.log("5. static-mirror: cascade order, @import and the print stylesheet survive...");
    const staticDir = path.join(tmpRoot, "static-mirror");
    scaffoldProject({ evidenceDir, targetDir: staticDir, mode: "static-mirror" });
    const css = fs.readFileSync(path.join(staticDir, "styles.css"), "utf8");
    assert.ok(/@media print\s*{[^}]*display:\s*none/.test(css), "print.css must stay inside @media print");
    assert.ok(css.indexOf("font-size: 56px") < css.indexOf("border-radius: 16px"), "@import must come before the importing sheet's rules");
    const verStatic = await verifyClone({ evidenceDir, cloneDir: staticDir, waitMs: 300 });
    assert.equal(verStatic.offline.passed, true, JSON.stringify(verStatic.issues));
    assert.ok(verStatic.results.desktop.fullDiff.similarityPct >= 99.5, `static ${verStatic.results.desktop.fullDiff.similarityPct}%`);

    console.log("6. vanilla: labelled blocks, real markup...");
    const vanillaDir = path.join(tmpRoot, "vanilla");
    const van = scaffoldProject({ evidenceDir, targetDir: vanillaDir, mode: "vanilla" });
    assert.ok(van.components.length >= 4, `Expected >=4 blocks, got ${JSON.stringify(van.components)}`);
    const vanillaHtml = fs.readFileSync(path.join(vanillaDir, "index.html"), "utf8");
    assert.ok(vanillaHtml.includes("Offline replay fixture") && vanillaHtml.includes("====="), "index.html must hold the labelled page");
    const verVanilla = await verifyClone({ evidenceDir, cloneDir: vanillaDir, waitMs: 300 });
    assert.ok(verVanilla.results.desktop.fullDiff.similarityPct >= 99.5, `vanilla ${verVanilla.results.desktop.fullDiff.similarityPct}%`);

    console.log("7. react-vite-tailwind: one component per block, bundled and rendered...");
    const reactDir = path.join(tmpRoot, "react");
    const rx = scaffoldProject({ evidenceDir, targetDir: reactDir, mode: "react-vite-tailwind" });
    const names = rx.components.map((c) => c.name);
    assert.ok(names.includes("Header") && names.includes("Footer"), `Expected Header and Footer, got ${names}`);
    for (const name of names) {
      const src = fs.readFileSync(path.join(reactDir, "src", "components", `${name}.jsx`), "utf8");
      assert.ok(src.length > 80 && src.includes(`export default function ${name}()`), `${name}.jsx is not a real component`);
    }
    // Bundle the generated sources the way Vite would, without its CSS plugins.
    const distDir = path.join(tmpRoot, "react-dist");
    fs.mkdirSync(distDir, { recursive: true });
    fs.cpSync(path.join(reactDir, "public"), distDir, { recursive: true });
    await build({
      entryPoints: [path.join(reactDir, "src", "main.jsx")],
      bundle: true,
      format: "esm",
      jsx: "automatic",
      outfile: path.join(distDir, "main.js"),
      loader: { ".css": "empty" },
      define: { "process.env.NODE_ENV": '"production"' },
      nodePaths: [path.join(process.cwd(), "node_modules")],
      logLevel: "silent",
    });
    fs.writeFileSync(
      path.join(distDir, "index.html"),
      fs.readFileSync(path.join(reactDir, "index.html"), "utf8").replace("/src/main.jsx", "/main.js")
    );
    const verReact = await verifyClone({ evidenceDir, cloneDir: distDir, waitMs: 300 });
    assert.equal(verReact.results.desktop.health.pageErrors.length, 0, JSON.stringify(verReact.results.desktop.health.pageErrors));
    assert.ok(verReact.results.desktop.fullDiff.similarityPct >= 99.5, `react ${verReact.results.desktop.fullDiff.similarityPct}%`);

    console.log("8. Offline enforcement: a clone that needs the internet is reported...");
    const leakyDir = path.join(tmpRoot, "leaky");
    fs.mkdirSync(leakyDir, { recursive: true });
    fs.writeFileSync(
      path.join(leakyDir, "index.html"),
      `<!DOCTYPE html><html><body><h1>Leaky</h1><img src="https://images.example.com/hero.png" alt=""></body></html>`
    );
    const verLeaky = await verifyClone({ evidenceDir, cloneDir: leakyDir, viewports: ["desktop"], waitMs: 200 });
    assert.equal(verLeaky.offline.passed, false, "A clone that loads from the internet must not pass the offline check");
    assert.ok(verLeaky.offline.externalRequests.some((u) => u.includes("images.example.com")));
    assert.equal(verLeaky.passedHealthChecks, false);

    console.log(
      `ALL MIRROR TESTS PASSED! exact ${ver.replayModes.exact.results.desktop.fullDiff.similarityPct}% / portable ${ver.replayModes.portable.results.desktop.fullDiff.similarityPct}% / static ${verStatic.results.desktop.fullDiff.similarityPct}% / vanilla ${verVanilla.results.desktop.fullDiff.similarityPct}% / react ${verReact.results.desktop.fullDiff.similarityPct}% (live servers were off)`
    );
  } finally {
    await stopLive();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
