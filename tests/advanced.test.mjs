import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn } from "node:child_process";
import { captureSite } from "../src/capture.mjs";
import { verifyClone } from "../src/verify.mjs";
import { scaffoldProject } from "../src/scaffold.mjs";
import { scaffoldMockBackend } from "../src/api-mock.mjs";
import { ingestLocalArchive } from "../src/ingest-local.mjs";
import { captureScrollScrub } from "../src/scroll-scrub.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "site-rea-v2-"));
const evidenceDir = path.join(tmpRoot, "evidence");
const cloneDir = path.join(tmpRoot, "clone-dynamic");
const offlineEvidenceDir = path.join(tmpRoot, "offline-evidence");
fs.mkdirSync(cloneDir, { recursive: true });

// Rich target page featuring: real WebGL2 GLSL shader + uniforms, scroll-driven sticky parallax,
// Lottie JSON fetch, and live JSON API fetch containing sensitive fields to verify redaction.
const RICH_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Site-REA v2 3D & SaaS Target</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, sans-serif; background: #090d16; color: #f8fafc; }
    .stage { position: relative; height: 2200px; }
    .sticky-box {
      position: sticky; top: 0; height: 900px;
      display: flex; align-items: center; justify-content: center; gap: 48px; padding: 48px;
    }
    canvas#gl-canvas { width: 420px; height: 320px; border-radius: 20px; display: block; }
    .parallax-card {
      width: 420px; padding: 32px; border-radius: 20px;
      background: linear-gradient(135deg, #1e293b, #0f172a);
      border: 1px solid rgba(56, 189, 248, 0.35);
      will-change: transform, opacity;
    }
    .api-list { padding: 64px 48px; max-width: 960px; margin: 0 auto; }
  </style>
</head>
<body>
  <section class="stage">
    <div class="sticky-box">
      <canvas id="gl-canvas" width="420" height="320"></canvas>
      <div class="parallax-card" id="p-card">
        <h1>Dynamic 3D & Scroll Choreography</h1>
        <p id="scroll-readout">Scroll progress: 0%</p>
      </div>
    </div>
  </section>
  <section class="api-list">
    <h2>Projects</h2>
    <ul id="projects-ul"></ul>
  </section>
  <script>
    // 1. Real WebGL2 shader compilation + uniforms
    const canvas = document.getElementById("gl-canvas");
    const gl = canvas.getContext("webgl2");
    let uProgressLoc = null;
    if (gl) {
      const vsSource = \`#version 300 es
        in vec2 aPos;
        out vec2 vUv;
        void main() {
          vUv = aPos * 0.5 + 0.5;
          gl_Position = vec4(aPos, 0.0, 1.0);
        }\`;
      const fsSource = \`#version 300 es
        precision highp float;
        in vec2 vUv;
        uniform float uProgress;
        uniform float uTime;
        uniform vec3 uAccent;
        out vec4 outColor;
        void main() {
          float wave = 0.08 * sin(vUv.y * 6.2831 + uTime * 0.002);
          vec3 col = mix(vec3(0.08, 0.14, 0.30), uAccent, clamp(vUv.x * 0.65 + uProgress * 0.35 + wave, 0.0, 1.0));
          outColor = vec4(col, 1.0);
        }\`;
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSource));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSource));
      gl.linkProgram(prog);
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "aPos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      uProgressLoc = gl.getUniformLocation(prog, "uProgress");
      const uTimeLoc = gl.getUniformLocation(prog, "uTime");
      const uAccentLoc = gl.getUniformLocation(prog, "uAccent");
      gl.uniform3f(uAccentLoc, 0.22, 0.74, 0.97);
      window.__uTimeLoc = uTimeLoc;
    }

    // Also attach a live scroll-animated Three-compatible camera & mesh to verify per-scroll matrix trajectories
    window.THREE = { REVISION: "175" };
    window.camera = { isCamera: true, type: "PerspectiveCamera", fov: 45, near: 0.1, far: 100, zoom: 1, position: { x: 0, y: 1.5, z: 5 }, rotation: { x: 0, y: 0, z: 0 } };
    const heroMesh = { isMesh: true, type: "Mesh", name: "HeroOrb", position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true };
    window.scene = { isScene: true, traverse(fn) { fn(heroMesh); } };

    function renderAtScroll() {
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const p = Math.min(1, Math.max(0, window.scrollY / maxScroll));
      const card = document.getElementById("p-card");
      card.style.transform = \`translate3d(0px, \${Math.round((0.5 - p) * 140)}px, 0px) scale(\${(0.92 + p * 0.12).toFixed(3)})\`;
      card.style.opacity = String((0.75 + p * 0.25).toFixed(3));
      document.getElementById("scroll-readout").textContent = \`Scroll progress: \${Math.round(p * 100)}%\`;
      window.camera.position.z = 5 - p * 2.5;
      heroMesh.rotation.y = p * 3.1416;
      if (gl && uProgressLoc) {
        gl.uniform1f(uProgressLoc, p);
        if (window.__uTimeLoc) gl.uniform1f(window.__uTimeLoc, performance.now());
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
    window.addEventListener("scroll", renderAtScroll, { passive: true });
    function loop() {
      renderAtScroll();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    // 2. Fetch Lottie animation JSON + SaaS API JSON
    fetch("/assets/hero-lottie.json").catch(() => {});
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        const ul = document.getElementById("projects-ul");
        for (const item of data.items || []) {
          const li = document.createElement("li");
          li.textContent = item.name;
          ul.appendChild(li);
        }
      })
      .catch(() => {});
  </script>
</body>
</html>`;

// Also write an identical dynamic clone so we can verify scroll-timeline pixel matching!
fs.writeFileSync(path.join(cloneDir, "index.html"), RICH_HTML, "utf8");

function startMockTargetServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/assets/hero-lottie.json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ v: "5.12.0", fr: 60, ip: 0, op: 120, w: 200, h: 200, layers: [{ ty: 4, nm: "Ring" }] }));
        return;
      }
      if (req.url === "/api/projects") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Set-Cookie": "session_id=super-secret-cookie",
        });
        res.end(
          JSON.stringify({
            items: [
              { id: "p1", name: "Orbital 3D", api_key: "sk-live-9999", password: "secret-password" },
              { id: "p2", name: "Parallax Studio", token: "tok-abcdef" },
            ],
          })
        );
        return;
      }
      if (req.url === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(RICH_HTML);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function run() {
  const targetSrv = await startMockTargetServer();
  let mockChild = null;

  try {
    console.log("1. Testing Route B: Deterministic virtual clock + WebGL2 uTime shader + Three.js per-scroll trajectories + Lottie + redacted API capture...");
    const cap = await captureSite({
      url: targetSrv.url,
      outputDir: evidenceDir,
      timelineSteps: 5,
      deterministic: true,
      captureRuntime: true,
      waitMs: 400,
    });
    assert.equal(cap.status, "ok");
    assert.equal(cap.deterministic, true);
    assert.ok(cap.runtimeCache && cap.runtimeCache.resourceCount >= 1, "Expected runtime-cache captured");
    assert.ok(cap.richMediaSummary.shaderCount >= 2, `Expected >=2 GLSL shaders, got ${cap.richMediaSummary.shaderCount}`);
    assert.ok(cap.richMediaSummary.uniformCount >= 1, "Expected recorded WebGL uniforms");
    assert.ok(cap.assetsSummary.lottieAnimations >= 1, `Expected >=1 Lottie JSON asset, got ${cap.assetsSummary.lottieAnimations}`);
    assert.ok(cap.scrollTimelineSummary && cap.scrollTimelineSummary.steps === 5, "Expected auto scroll timeline with 5 stops");
    assert.ok(cap.scrollTimelineSummary.animatedTracksCount >= 1, "Expected >=1 detected scroll-animated track");
    assert.ok(cap.scrollTimelineSummary.uniformTrackCount >= 1, "Expected >=1 WebGL uniform track across scroll stops");
    assert.equal(cap.scrollTimelineSummary.threeCameraKeyframes, 5, "Expected 5 Three.js camera keyframes");
    assert.ok(cap.apiContractsSummary.recordedEndpoints >= 1, "Expected >=1 recorded API endpoint");

    // Verify per-scroll-frame Three.js camera & mesh matrix trajectories in scroll-timeline.json
    const tl = JSON.parse(fs.readFileSync(path.join(evidenceDir, "scroll-timeline.json"), "utf8"));
    assert.ok(tl.threeCameraTrack[0].position[2] > tl.threeCameraTrack[4].position[2], "Expected Three.js camera Z trajectory");
    assert.equal(tl.threeMeshTracks.HeroOrb.animated, true, "Expected HeroOrb rotation trajectory marked animated");
    assert.ok(Array.isArray(tl.uniformTracks.uProgress) && tl.uniformTracks.uProgress.length === 5, "Expected uProgress uniform trajectory");

    // Verify strict credential redaction in api-contracts.json
    const contracts = JSON.parse(fs.readFileSync(cap.apiContractsSummary.apiContractsPath, "utf8"));
    const projEp = contracts.endpoints.find((e) => e.pathname === "/api/projects");
    assert.ok(projEp, "Expected /api/projects in api-contracts.json");
    assert.equal(projEp.sampleResponse.items[0].api_key, "[REDACTED]");
    assert.equal(projEp.sampleResponse.items[0].password, "[REDACTED]");
    assert.equal(projEp.sampleResponse.items[1].token, "[REDACTED]");

    // Verify GLSL shaders were actually persisted to disk
    const richMedia = JSON.parse(fs.readFileSync(path.join(evidenceDir, "rich-media.json"), "utf8"));
    assert.ok(richMedia.webgl.shaderFiles.some((f) => f.type === "vertex"));
    assert.ok(richMedia.webgl.shaderFiles.some((f) => f.type === "fragment"));
    const fragContent = fs.readFileSync(
      path.join(evidenceDir, richMedia.webgl.shaderFiles.find((f) => f.type === "fragment").localPath),
      "utf8"
    );
    assert.ok(fragContent.includes("uProgress"), "Fragment shader source should contain uProgress uniform");

    console.log("2. Testing Route A (runtime-mirror) offline native replay + deterministic frame-locked verifyClone...");
    const runtimeMirrorDir = path.join(tmpRoot, "clone-runtime-mirror");
    const rmRes = scaffoldProject({ evidenceDir, targetDir: runtimeMirrorDir, mode: "runtime-mirror" });
    assert.equal(rmRes.status, "ok");
    assert.ok(fs.existsSync(rmRes.serverPath));

    const ver = await verifyClone({
      evidenceDir,
      cloneDir: runtimeMirrorDir,
      viewports: ["desktop"],
      verifyScrollTimeline: true,
      deterministic: "auto",
      waitMs: 300,
    });
    assert.equal(ver.status, "ok");
    assert.equal(ver.deterministic, true);
    assert.equal(ver.passedHealthChecks, true, `runtime-mirror health failed: ${JSON.stringify(ver.issues)}`);
    assert.ok(Array.isArray(ver.results.desktop.scrollTimelineDiffs), "Expected scrollTimelineDiffs array");
    assert.equal(ver.results.desktop.scrollTimelineDiffs.length, 5);
    assert.ok(
      ver.results.desktop.dynamicSimilarityPct >= 99,
      `Expected >=99% frame-locked runtime-mirror dynamic similarity, got ${ver.results.desktop.dynamicSimilarityPct}%`
    );

    console.log("2b. Testing Route C (Apple-style scroll-scrub canvas) capture & scaffold...");
    const scrubRes = await captureScrollScrub({
      url: targetSrv.url,
      evidenceDir,
      frameCount: 10,
      format: "jpeg",
      deterministic: true,
    });
    assert.equal(scrubRes.status, "ok");
    assert.equal(scrubRes.frameCount, 10);
    assert.ok(fs.existsSync(scrubRes.playerScriptPath));
    const scrubCloneDir = path.join(tmpRoot, "clone-scroll-scrub");
    const scrubScaf = scaffoldProject({ evidenceDir, targetDir: scrubCloneDir, mode: "scroll-scrub" });
    assert.equal(scrubScaf.status, "ok");
    assert.equal(scrubScaf.frameCount, 10);
    assert.ok(fs.existsSync(path.join(scrubCloneDir, "scripts", "scroll-scrub-player.js")));
    const scrubVer = await verifyClone({
      evidenceDir,
      cloneDir: scrubCloneDir,
      viewports: ["desktop"],
      verifyScrollTimeline: false,
      waitMs: 400,
    });
    assert.equal(scrubVer.passedHealthChecks, true, `scroll-scrub health failed: ${JSON.stringify(scrubVer.issues)}`);

    console.log("3. Testing scaffoldMockBackend & live stateful CRUD...");
    const mockPort = 14987;
    const mockRes = scaffoldMockBackend({ evidenceDir, targetDir: cloneDir, port: mockPort });
    assert.equal(mockRes.status, "ok");
    assert.ok(fs.existsSync(mockRes.serverPath));
    assert.ok(fs.existsSync(mockRes.bridgePath));

    mockChild = spawn(process.execPath, [mockRes.serverPath], { stdio: "pipe" });
    await new Promise((r) => setTimeout(r, 500));

    const get1 = await fetch(`http://127.0.0.1:${mockPort}/api/projects`).then((r) => r.json());
    assert.equal(get1.items.length, 2);

    const post1 = await fetch(`http://127.0.0.1:${mockPort}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "p3", name: "Created In Mock" }),
    });
    assert.equal(post1.status, 201);

    const get2 = await fetch(`http://127.0.0.1:${mockPort}/api/projects`).then((r) => r.json());
    assert.equal(get2.items.length, 3);

    const del1 = await fetch(`http://127.0.0.1:${mockPort}/api/projects/p3`, { method: "DELETE" });
    assert.equal(del1.status, 200);

    const loginRes = await fetch(`http://127.0.0.1:${mockPort}/api/__mock_auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Admin" }),
    }).then((r) => r.json());
    assert.equal(loginRes.ok, true);

    console.log("4. Testing strict offline ingestLocalArchive (local HTML + HAR)...");
    const savedHtmlPath = path.join(tmpRoot, "saved-page.html");
    fs.writeFileSync(
      savedHtmlPath,
      `<!DOCTYPE html><html><head><title>Offline Saved</title><style>body{background:#111;color:#fff;font-family:sans-serif;padding:40px;}</style></head><body><h1>Saved Offline</h1><p>No live network needed.</p></body></html>`,
      "utf8"
    );
    const savedHarPath = path.join(tmpRoot, "session.har");
    fs.writeFileSync(
      savedHarPath,
      JSON.stringify({
        log: {
          version: "1.2",
          entries: [
            {
              request: { method: "GET", url: "https://private.example.local/api/me" },
              response: {
                status: 200,
                content: {
                  mimeType: "application/json",
                  text: JSON.stringify({ user: "Alice", access_token: "secret-jwt-123" }),
                },
              },
            },
          ],
        },
      }),
      "utf8"
    );

    const ingested = await ingestLocalArchive({
      htmlPath: savedHtmlPath,
      harPath: savedHarPath,
      outputDir: offlineEvidenceDir,
      captureMobile: false,
    });
    assert.equal(ingested.status, "ok");
    assert.equal(ingested.mode, "offline-local-archive");
    assert.equal(ingested.apiContractsCount, 1);
    assert.ok(fs.existsSync(ingested.screenshots.desktopHero));
    const harContracts = JSON.parse(fs.readFileSync(ingested.apiContractsPath, "utf8"));
    assert.equal(harContracts.endpoints[0].sampleResponse.access_token, "[REDACTED]");

    console.log("5. Testing real WebGPU WGSL shader + pipeline + Three.js scene graph capture...");
    const webgpuEvidenceDir = path.join(tmpRoot, "webgpu-evidence");
    const webgpuHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>WebGPU + Three Scene Test</title>
<style>body{margin:0;background:#050814;display:grid;place-items:center;height:100vh;}canvas{width:400px;height:300px;}</style>
</head>
<body>
<canvas id="gpu-canvas" width="400" height="300"></canvas>
<script>
  // Expose a lightweight Three.js-compatible scene/camera mock to test scene graph extraction
  window.THREE = { REVISION: "175" };
  window.camera = { isCamera: true, type: "PerspectiveCamera", fov: 45, near: 0.1, far: 100, zoom: 1, position: { x: 0, y: 1.5, z: 5 }, rotation: { x: 0, y: 0, z: 0 } };
  window.scene = {
    isScene: true,
    background: { getHexString: () => "050814" },
    traverse(fn) {
      fn({ isLight: true, type: "DirectionalLight", name: "KeyLight", color: { getHexString: () => "ffffff" }, intensity: 2.5, position: { x: 4, y: 6, z: 3 }, castShadow: true });
      fn({ isMesh: true, type: "Mesh", name: "HeroSphere", position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0.5, z: 0 }, scale: { x: 1, y: 1, z: 1 }, geometry: { type: "SphereGeometry", attributes: { position: { count: 1024 } } }, material: { type: "MeshStandardMaterial", color: { getHexString: () => "38bdf8" }, roughness: 0.2, metalness: 0.85 } });
    }
  };
  (async () => {
    if (!navigator.gpu) return;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return;
    const device = await adapter.requestDevice();
    const canvas = document.getElementById("gpu-canvas");
    const ctx = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: "premultiplied" });
    const module = device.createShaderModule({
      label: "hero-triangle-wgsl",
      code: \`
        @vertex fn vs_main(@builtin(vertex_index) idx: u32) -> @builtin(position) vec4f {
          var pos = array<vec2f, 3>(vec2f(0.0, 0.7), vec2f(-0.7, -0.7), vec2f(0.7, -0.7));
          return vec4f(pos[idx], 0.0, 1.0);
        }
        @fragment fn fs_main() -> @location(0) vec4f {
          return vec4f(0.22, 0.74, 0.97, 1.0);
        }
      \`
    });
    const pipeline = device.createRenderPipeline({
      label: "hero-pipeline",
      layout: "auto",
      vertex: { module, entryPoint: "vs_main" },
      fragment: { module, entryPoint: "fs_main", targets: [{ format }] }
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0.02, g: 0.03, b: 0.08, a: 1 }, loadOp: "clear", storeOp: "store" }]
    });
    pass.setPipeline(pipeline);
    pass.draw(3);
    pass.end();
    device.queue.submit([enc.finish()]);
  })();
</script>
</body></html>`;

    const webgpuSrv = await new Promise((resolve) => {
      const s = http.createServer((req, res) => {
        if (req.url === "/favicon.ico") { res.writeHead(204); return res.end(); }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(webgpuHtml);
      });
      s.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((r) => s.close(r)) }));
    });
    try {
      const gpuCap = await captureSite({
        url: webgpuSrv.url,
        outputDir: webgpuEvidenceDir,
        captureMobile: false,
        captureTimeline: false,
        waitMs: 500,
      });
      assert.equal(gpuCap.status, "ok");
      assert.equal(gpuCap.richMediaSummary.hasThreeSceneGraph, true, "Expected Three.js scene graph captured");
      assert.equal(gpuCap.richMediaSummary.webgpuSupported, true, "Expected WebGPU enabled in GPU-backed Chrome");
      assert.ok(gpuCap.richMediaSummary.webgpuShaderCount >= 1, `Expected >=1 WGSL shader captured, got ${gpuCap.richMediaSummary.webgpuShaderCount}`);
      assert.ok(gpuCap.richMediaSummary.webgpuRenderPipelines >= 1, "Expected >=1 WebGPU render pipeline captured");
      const gpuRich = JSON.parse(fs.readFileSync(path.join(webgpuEvidenceDir, "rich-media.json"), "utf8"));
      const wgslText = fs.readFileSync(path.join(webgpuEvidenceDir, gpuRich.webgpu.wgslFiles[0].localPath), "utf8");
      assert.ok(wgslText.includes("@fragment fn fs_main"), "Captured WGSL file should contain fs_main");
      assert.equal(gpuRich.threeScene.meshes[0].name, "HeroSphere");
      assert.equal(gpuRich.threeScene.lights[0].name, "KeyLight");
    } finally {
      await webgpuSrv.close();
    }

    console.log(
      `ALL ADVANCED TESTS PASSED! Route-A runtime-mirror dynamic similarity: ${ver.results.desktop.dynamicSimilarityPct}%, Route-B deterministic clock + Three/Uniform trajectories: OK, Route-C scroll-scrub (${scrubRes.frameCount} frames): OK, WebGPU WGSL + Three Scene Graph: OK, Mock CRUD: OK, Offline HAR+HTML: OK`
    );
  } finally {
    if (mockChild) mockChild.kill();
    await targetSrv.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error("V2 ADVANCED TEST FAILED:", err);
  process.exit(1);
});
