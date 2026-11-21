import fs from "node:fs";
import path from "node:path";
import { scaffoldRuntimeMirror } from "./runtime-mirror.mjs";
import { writeScrollScrubPlayerFiles } from "./scroll-scrub.mjs";
import { generateCleanProject } from "./codegen.mjs";

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

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildTokensCss(tokens) {
  const lines = ["/* Auto-extracted by Site-REA from target site */", ":root {"];

  // Extracted semantic defaults
  const bg = tokens.pageBackground || tokens.colors?.backgrounds?.[0]?.value || "#ffffff";
  const text = tokens.colors?.text?.[0]?.value || (tokens.theme === "dark" ? "#f5f5f5" : "#111111");
  const accent = tokens.colors?.accents?.[0]?.value || "#2563eb";
  const border = tokens.colors?.borders?.[0]?.value || (tokens.theme === "dark" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)");
  const bodyFont = tokens.typography?.body?.fontFamily || "system-ui, -apple-system, sans-serif";
  const headingFont = tokens.typography?.h1?.fontFamily || bodyFont;
  const containerMax = tokens.layout?.containerWidths?.[0]?.value || "1280px";

  lines.push(`  --site-bg: ${bg};`);
  lines.push(`  --site-text: ${text};`);
  lines.push(`  --site-accent: ${accent};`);
  lines.push(`  --site-border: ${border};`);
  lines.push(`  --site-font-body: ${bodyFont};`);
  lines.push(`  --site-font-heading: ${headingFont};`);
  lines.push(`  --site-container-max: ${containerMax};`);

  // Original :root CSS custom properties
  const vars = tokens.cssVariables || {};
  const varEntries = Object.entries(vars).slice(0, 120);
  if (varEntries.length > 0) {
    lines.push("");
    lines.push("  /* Extracted original :root CSS variables */");
    for (const [k, v] of varEntries) {
      lines.push(`  ${k}: ${v};`);
    }
  }
  lines.push("}");

  // Extracted keyframes
  if (Array.isArray(tokens.keyframes) && tokens.keyframes.length > 0) {
    lines.push("");
    lines.push("/* Extracted @keyframes */");
    for (const kf of tokens.keyframes.slice(0, 20)) {
      lines.push(kf.cssText);
    }
  }

  lines.push("");
  lines.push("*, *::before, *::after { box-sizing: border-box; }");
  lines.push("html, body {");
  lines.push("  margin: 0;");
  lines.push("  padding: 0;");
  lines.push("  background-color: var(--site-bg);");
  lines.push("  color: var(--site-text);");
  lines.push("  font-family: var(--site-font-body);");
  lines.push("  -webkit-font-smoothing: antialiased;");
  lines.push("}");
  lines.push("img, svg, video { max-width: 100%; height: auto; }");

  return lines.join("\n") + "\n";
}

function buildFontHeadLinks(tokens) {
  const links = (tokens.fonts?.links || [])
    .map((href) => `  <link rel="stylesheet" href="${escapeHtml(href)}" />`)
    .join("\n");
  return links;
}

export function scaffoldProject({
  evidenceDir,
  targetDir,
  mode = "vanilla",
  copyAssets = true,
}) {
  const resolvedEvidence = path.resolve(evidenceDir);
  const resolvedTarget = path.resolve(targetDir);

  const tokensPath = path.join(resolvedEvidence, "design-tokens.json");
  const manifestPath = path.join(resolvedEvidence, "manifest.json");
  if (!fs.existsSync(tokensPath)) {
    throw new Error(`design-tokens.json not found in ${resolvedEvidence}. Run capture_site first.`);
  }

  const tokens = JSON.parse(fs.readFileSync(tokensPath, "utf8"));
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : {};
  const assetsManifestPath = path.join(resolvedEvidence, "assets-manifest.json");
  const assetsManifest = fs.existsSync(assetsManifestPath)
    ? JSON.parse(fs.readFileSync(assetsManifestPath, "utf8"))
    : [];
  const richMediaPath = path.join(resolvedEvidence, "rich-media.json");
  const richMedia = fs.existsSync(richMediaPath)
    ? JSON.parse(fs.readFileSync(richMediaPath, "utf8"))
    : null;
  const apiContractsPath = path.join(resolvedEvidence, "api-contracts.json");
  const apiContracts = fs.existsSync(apiContractsPath)
    ? JSON.parse(fs.readFileSync(apiContractsPath, "utf8"))
    : null;

  fs.mkdirSync(resolvedTarget, { recursive: true });

  const copyShadersIfPresent = (destShadersDir) => {
    let copied = 0;
    const srcGlsl = path.join(resolvedEvidence, "webgl", "shaders");
    if (fs.existsSync(srcGlsl)) {
      copied += copyDirRecursive(srcGlsl, path.join(destShadersDir, "glsl"));
    }
    const srcWgsl = path.join(resolvedEvidence, "webgl", "wgsl");
    if (fs.existsSync(srcWgsl)) {
      copied += copyDirRecursive(srcWgsl, path.join(destShadersDir, "wgsl"));
    }
    return copied;
  };

  // Find local favicon if downloaded
  const localFavicon = assetsManifest.find((a) => a.role === "favicon" && a.downloaded && a.localPath)?.localPath;

  if (mode === "runtime-mirror") {
    return scaffoldRuntimeMirror({
      evidenceDir: resolvedEvidence,
      targetDir: resolvedTarget,
    });
  }

  if (mode === "scroll-scrub") {
    const scrubSrc = path.join(resolvedEvidence, "scrub");
    const scrubManifestPath = path.join(scrubSrc, "scrub-manifest.json");
    if (!fs.existsSync(scrubManifestPath)) {
      throw new Error(
        `scrub/scrub-manifest.json not found in ${resolvedEvidence}. Run capture_scroll_scrub first.`
      );
    }
    const scrubManifest = JSON.parse(fs.readFileSync(scrubManifestPath, "utf8"));
    let copiedAssets = 0;
    if (copyAssets) {
      copiedAssets += copyDirRecursive(path.join(resolvedEvidence, "assets"), path.join(resolvedTarget, "assets"));
      copiedAssets += copyDirRecursive(path.join(scrubSrc, "frames"), path.join(resolvedTarget, "scrub", "frames"));
    }
    fs.mkdirSync(path.join(resolvedTarget, "styles"), { recursive: true });
    fs.mkdirSync(path.join(resolvedTarget, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(resolvedTarget, "styles", "tokens.css"), buildTokensCss(tokens), "utf8");
    fs.writeFileSync(
      path.join(resolvedTarget, "styles", "main.css"),
      `/* Outer clean UI styles + Apple-style sticky scroll-scrub canvas stage */
.scrub-stage-track { position: relative; height: ${scrubManifest.scrollHeight || 3600}px; }
.scrub-stage-sticky { position: sticky; top: 0; width: 100%; height: 100vh; overflow: hidden; }
canvas#scrub-canvas { width: 100%; height: 100%; display: block; }
.scrub-overlay { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
.scrub-overlay a, .scrub-overlay button { pointer-events: auto; }
`,
      "utf8"
    );
    writeScrollScrubPlayerFiles(path.join(resolvedTarget, "scripts"), scrubManifest, {
      framesPrefix: "./scrub/",
    });
    // Remove duplicate demo.html inside scripts/
    const scriptsDemo = path.join(resolvedTarget, "scripts", "demo.html");
    if (fs.existsSync(scriptsDemo)) fs.unlinkSync(scriptsDemo);

    const fontLinksScrub = buildFontHeadLinks(tokens);
    const titleScrub = escapeHtml(tokens.meta?.title || "Scroll-Scrub 3D Experience");
    const descScrub = escapeHtml(tokens.meta?.description || "");
    const langScrub = escapeHtml(tokens.meta?.lang || "en");
    const favTagScrub = localFavicon ? `  <link rel="icon" href="./${localFavicon}" />` : "";
    const resolvedFrames = (scrubManifest.frames || []).map((f) => `./scrub/${f}`);

    fs.writeFileSync(
      path.join(resolvedTarget, "index.html"),
      `<!DOCTYPE html>
<html lang="${langScrub}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${titleScrub}</title>
  <meta name="description" content="${descScrub}" />
${favTagScrub}
${fontLinksScrub}
  <link rel="stylesheet" href="./styles/tokens.css" />
  <link rel="stylesheet" href="./styles/main.css" />
</head>
<body>
  <main class="scrub-stage-track" id="scrub-track">
    <div class="scrub-stage-sticky">
      <canvas id="scrub-canvas"></canvas>
      <div class="scrub-overlay" id="scrub-overlay">
        <!-- Reconstruct clean semantic nav, headlines, and CTAs here -->
      </div>
    </div>
  </main>
  <script type="module">
    import { ScrollScrubPlayer } from "./scripts/scroll-scrub-player.js";
    new ScrollScrubPlayer({
      canvas: "#scrub-canvas",
      track: "#scrub-track",
      frames: ${JSON.stringify(resolvedFrames)},
      frameWidth: ${scrubManifest.frameWidth || 1440},
      frameHeight: ${scrubManifest.frameHeight || 900},
      smoothing: 1.0
    });
  </script>
</body>
</html>
`,
      "utf8"
    );

    return {
      status: "ok",
      mode: "scroll-scrub",
      targetDir: resolvedTarget,
      copiedAssets,
      frameCount: scrubManifest.frameCount,
      scrollHeight: scrubManifest.scrollHeight,
      filesCreated: [
        path.join(resolvedTarget, "index.html"),
        path.join(resolvedTarget, "styles", "tokens.css"),
        path.join(resolvedTarget, "styles", "main.css"),
        path.join(resolvedTarget, "scripts", "scroll-scrub-player.js"),
      ],
      notes: "Scroll-scrub project created: a canvas plays the recorded frames as the page scrolls. It is a film of the original at the recorded viewport size; headings, links and buttons have to be added on top in #scrub-overlay.",
    };
  }

  if (mode === "static-mirror") {
    const mirrorDir = path.join(resolvedEvidence, "mirror");
    if (!fs.existsSync(mirrorDir)) {
      throw new Error(`mirror/ directory not found in ${resolvedEvidence}. Capture with capture_mirror: true.`);
    }
    let copiedAssets = 0;
    if (copyAssets) {
      copiedAssets = copyDirRecursive(path.join(resolvedEvidence, "assets"), path.join(resolvedTarget, "assets"));
    }
    // Copy mirror index.html & styles.css and adjust relative ../assets/ -> ./assets/
    const rawHtml = fs.readFileSync(path.join(mirrorDir, "index.html"), "utf8").replaceAll("../assets/", "./assets/");
    const rawCss = fs.readFileSync(path.join(mirrorDir, "styles.css"), "utf8").replaceAll("../assets/", "./assets/");
    fs.writeFileSync(path.join(resolvedTarget, "index.html"), rawHtml, "utf8");
    fs.writeFileSync(path.join(resolvedTarget, "styles.css"), rawCss, "utf8");

    return {
      status: "ok",
      mode,
      targetDir: resolvedTarget,
      copiedAssets,
      filesCreated: [
        path.join(resolvedTarget, "index.html"),
        path.join(resolvedTarget, "styles.css"),
      ],
      notes: "1:1 frozen static mirror ready to serve or edit directly.",
    };
  }

  // vanilla / react-vite-tailwind: the captured page, split into its blocks.
  const cleanMode = mode === "react-vite-tailwind" ? "react-vite-tailwind" : "vanilla";
  const generated = generateCleanProject({
    evidenceDir: resolvedEvidence,
    targetDir: resolvedTarget,
    mode: cleanMode,
    tokens,
    copyAssets,
  });
  let copiedAssets = generated.copiedAssets;
  if (copyAssets) {
    const shaderDest =
      cleanMode === "react-vite-tailwind"
        ? path.join(resolvedTarget, "public", "assets", "shaders")
        : path.join(resolvedTarget, "assets", "shaders");
    copiedAssets += copyShadersIfPresent(shaderDest);
  }

  return {
    status: "ok",
    mode: cleanMode,
    targetDir: resolvedTarget,
    copiedAssets,
    assetsPublicPrefix: generated.assetsPublicPrefix,
    components: generated.components,
    extractedInlineImages: generated.extractedImages,
    detectedEngines: richMedia?.engines || [],
    shaderCount: richMedia?.webgl?.shaderCount || 0,
    recordedApiEndpoints: apiContracts?.totalEndpoints || 0,
    filesCreated: generated.filesCreated,
    notes:
      cleanMode === "react-vite-tailwind"
        ? "React + Vite project generated: one component per page block, the site's own CSS in public/site.css, Tailwind utilities available. Markup and styling are the captured ones; behaviour (menus, sliders, forms) has to be written. Run `npm install && npm run build`, then verify_clone on dist/."
        : "Static project generated: index.html with every block labelled, the site's own CSS in styles/site.css. Markup and styling are the captured ones; behaviour (menus, sliders, forms) has to be written in scripts/main.js.",
  };
}
