import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { startStaticServer } from "../src/static-server.mjs";
import { captureSite } from "../src/capture.mjs";
import { scaffoldProject } from "../src/scaffold.mjs";
import { verifyClone } from "../src/verify.mjs";
import { probeInteraction } from "../src/probe.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "site-rea-smoke-"));
const mockSiteDir = path.join(tmpRoot, "mock-site");
const evidenceDir = path.join(tmpRoot, "evidence");
const mirrorCloneDir = path.join(tmpRoot, "clone-mirror");
const vanillaCloneDir = path.join(tmpRoot, "clone-vanilla");
const reactCloneDir = path.join(tmpRoot, "clone-react");

fs.mkdirSync(mockSiteDir, { recursive: true });

// Create a small 1x1 PNG asset for image download testing
const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR42mP8z8DwnwEIwDiqYBgqAAA2jQQB8/m2WQAAAABJRU5ErkJggg==";
fs.writeFileSync(path.join(mockSiteDir, "banner.png"), Buffer.from(tinyPngBase64, "base64"));

fs.writeFileSync(
  path.join(mockSiteDir, "index.html"),
  `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Site-REA Smoke Target</title>
  <meta name="description" content="Sample target for Site-REA automated verification" />
  <style>
    :root {
      --brand-bg: #0f172a;
      --brand-fg: #f8fafc;
      --brand-accent: #38bdf8;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: var(--brand-bg); color: var(--brand-fg); }
    header { display: flex; justify-content: space-between; align-items: center; padding: 20px 48px; border-bottom: 1px solid rgba(255,255,255,0.12); }
    nav a { color: #cbd5e1; text-decoration: none; margin-left: 24px; }
    .hero { max-width: 1120px; margin: 0 auto; padding: 80px 48px; display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 32px; align-items: center; }
    .hero h1 { font-size: 48px; margin: 0 0 16px; }
    .cta { background: var(--brand-accent); color: #0f172a; border: none; padding: 14px 28px; border-radius: 10px; font-weight: 700; cursor: pointer; }
    .faq { max-width: 1120px; margin: 0 auto; padding: 48px; }
    .faq-body { display: none; margin-top: 12px; color: #94a3b8; }
    .faq-body.open { display: block; }
    footer { padding: 32px 48px; border-top: 1px solid rgba(255,255,255,0.12); color: #94a3b8; }
    @media (max-width: 768px) {
      header { padding: 16px 20px; }
      .hero { grid-template-columns: 1fr; padding: 40px 20px; }
      .hero h1 { font-size: 32px; }
    }
  </style>
</head>
<body>
  <header>
    <div style="display:flex;align-items:center;gap:10px;font-weight:700;">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#38bdf8" stroke-width="2.5"/></svg>
      <span>SiteREA Demo</span>
    </div>
    <nav>
      <a href="/features">Features</a>
      <a href="/pricing">Pricing</a>
    </nav>
  </header>
  <section class="hero">
    <div>
      <h1>Reverse Engineer Any Website</h1>
      <p>Automated design tokens, semantic blueprints, localized assets, and visual parity checks.</p>
      <button class="cta" id="primary-cta">Clone Now</button>
    </div>
    <img src="./banner.png" alt="Demo Banner" width="320" height="240" style="width:320px;height:240px;border-radius:16px;object-fit:cover;" />
  </section>
  <section class="faq">
    <h2>FAQ</h2>
    <button id="faq-btn" aria-expanded="false">How does Site-REA work?</button>
    <div id="faq-body" class="faq-body">It captures rendered screenshots, CSS tokens, DOM blueprints, and verifies visual diffs.</div>
  </section>
  <footer>
    <p>© 2026 Site-REA Test Fixture</p>
  </footer>
  <script>
    document.getElementById("faq-btn").addEventListener("click", (e) => {
      const body = document.getElementById("faq-body");
      const open = body.classList.toggle("open");
      e.currentTarget.setAttribute("aria-expanded", String(open));
    });
  </script>
</body>
</html>`,
  "utf8"
);

async function testMcpHandshake() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve("bin/site-rea.mjs"), "mcp"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("MCP handshake timed out"));
    }, 10000);

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result) {
            child.stdin.write(
              JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n"
            );
            child.stdin.write(
              JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n"
            );
          } else if (msg.id === 2 && msg.result) {
            clearTimeout(timer);
            child.kill();
            resolve(msg.result.tools.map((t) => t.name));
          }
        } catch {}
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "smoke-test", version: "1.0.0" },
        },
      }) + "\n"
    );
  });
}

async function run() {
  const srv = await startStaticServer(mockSiteDir, { port: 0 });
  try {
    console.log("1. Testing captureSite...");
    const cap = await captureSite({
      url: srv.url,
      outputDir: evidenceDir,
      waitMs: 300,
    });
    assert.equal(cap.status, "ok");
    assert.equal(cap.theme, "dark");
    assert.ok(cap.sectionsIndex.length >= 3, `Expected >=3 sections, got ${cap.sectionsIndex.length}`);
    assert.ok(cap.assetsSummary.inlineSvgs >= 1, "Expected >=1 inline SVG");
    assert.ok(cap.assetsSummary.downloaded >= 1, "Expected >=1 downloaded image");
    assert.ok(fs.existsSync(cap.screenshots.desktopHero));
    assert.ok(fs.existsSync(cap.screenshots.mobileHero));
    assert.ok(fs.existsSync(cap.mirror.mirrorHtmlPath));

    console.log("2. Testing probeInteraction...");
    const probe = await probeInteraction({
      url: srv.url,
      evidenceDir,
      action: "click",
      selector: "#faq-btn",
    });
    assert.equal(probe.status, "ok");
    assert.equal(probe.expandedCountDelta, 1, "Expected FAQ aria-expanded count to increase by 1");
    assert.ok(fs.existsSync(probe.screenshots.after));

    console.log("3. Testing scaffoldProject (static-mirror, vanilla, react-vite-tailwind)...");
    const scMirror = scaffoldProject({ evidenceDir, targetDir: mirrorCloneDir, mode: "static-mirror" });
    assert.equal(scMirror.status, "ok");
    const scVanilla = scaffoldProject({ evidenceDir, targetDir: vanillaCloneDir, mode: "vanilla" });
    assert.equal(scVanilla.status, "ok");
    assert.ok(fs.existsSync(path.join(vanillaCloneDir, "styles", "tokens.css")));
    const scReact = scaffoldProject({ evidenceDir, targetDir: reactCloneDir, mode: "react-vite-tailwind" });
    assert.equal(scReact.status, "ok");
    assert.ok(fs.existsSync(path.join(reactCloneDir, "package.json")));

    console.log("4. Testing verifyClone against 1:1 mirror...");
    const ver = await verifyClone({
      evidenceDir,
      cloneDir: mirrorCloneDir,
      viewports: ["desktop", "mobile"],
      waitMs: 300,
    });
    assert.equal(ver.status, "ok");
    assert.equal(ver.passedHealthChecks, true, `Health checks failed: ${JSON.stringify(ver.issues)}`);
    assert.ok(
      ver.results.desktop.heroDiff.similarityPct >= 95,
      `Expected >=95% desktop hero similarity, got ${ver.results.desktop.heroDiff.similarityPct}%`
    );
    assert.ok(fs.existsSync(ver.results.desktop.heroDiff.compositeDiffPath));

    console.log("5. Testing MCP stdio server tools/list...");
    const tools = await testMcpHandshake();
    assert.ok(tools.includes("capture_site"));
    assert.ok(tools.includes("capture_scroll_timeline"));
    assert.ok(tools.includes("capture_scroll_scrub"));
    assert.ok(tools.includes("inspect_rich_media"));
    assert.ok(tools.includes("scaffold_mock_backend"));
    assert.ok(tools.includes("ingest_local_archive"));
    assert.ok(tools.includes("verify_clone"));
    assert.equal(tools.length, 14, `Expected 14 MCP tools, got ${tools.length}: ${tools.join(", ")}`);

    console.log(
      `ALL SMOKE TESTS PASSED! Desktop hero similarity: ${ver.results.desktop.heroDiff.similarityPct}%, Mobile hero similarity: ${ver.results.mobile.heroDiff.similarityPct}%, MCP tools: ${tools.length}`
    );
  } finally {
    await srv.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});
