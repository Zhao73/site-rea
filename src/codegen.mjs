import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parse, serialize, serializeOuter } from "parse5";
import { elementToJsx, openTagSource } from "./html-to-jsx.mjs";

const SEMANTIC_BLOCK_TAGS = new Set(["header", "footer", "nav", "section", "article", "aside", "form"]);
const NON_RENDERED_TAGS = new Set(["script", "noscript", "style", "template", "link", "meta", "base", "title"]);
const DATA_URI_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg", "image/avif": "avif" };

const isElement = (n) => n && typeof n.tagName === "string";
const elementChildren = (n) => (n.childNodes || []).filter((c) => isElement(c) && !NON_RENDERED_TAGS.has(c.tagName));
const attrOf = (n, name) => (n.attrs || []).find((a) => a.name === name)?.value ?? null;

function textOf(node, limit = 400) {
  let out = "";
  const stack = [node];
  while (stack.length > 0 && out.length < limit) {
    const n = stack.pop();
    if (n.nodeName === "#text") out += n.value + " ";
    else if (isElement(n) && !NON_RENDERED_TAGS.has(n.tagName)) stack.push(...[...(n.childNodes || [])].reverse());
  }
  return out.replace(/\s+/g, " ").trim();
}

function findFirst(node, predicate) {
  const stack = [node];
  while (stack.length > 0) {
    const n = stack.pop();
    if (isElement(n) && predicate(n)) return n;
    if (n.childNodes) stack.push(...[...n.childNodes].reverse());
  }
  return null;
}

function markupSize(node) {
  if (node.nodeName === "#text") return node.value.length;
  let size = 20;
  for (const a of node.attrs || []) size += a.name.length + a.value.length;
  for (const c of node.childNodes || []) size += markupSize(c);
  return size;
}

/** Moves large inline data: images out of the markup into real files. */
function extractInlineImages(root, assetsDir) {
  let extracted = 0;
  const stack = [root];
  while (stack.length > 0) {
    const n = stack.pop();
    if (n.childNodes) stack.push(...n.childNodes);
    if (!isElement(n)) continue;
    for (const attr of n.attrs || []) {
      if (!["src", "href", "poster"].includes(attr.name)) continue;
      const m = /^data:(image\/[a-z0-9.+-]+)(;base64)?,/i.exec(attr.value);
      if (!m || attr.value.length < 2048) continue;
      const ext = DATA_URI_EXT[m[1].toLowerCase()];
      if (!ext) continue;
      const payload = attr.value.slice(m[0].length);
      const buf = m[2] ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
      const name = `${crypto.createHash("sha1").update(buf).digest("hex").slice(0, 12)}.${ext}`;
      const dir = path.join(assetsDir, "extracted");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), buf);
      attr.value = `../assets/extracted/${name}`;
      extracted++;
    }
  }
  return extracted;
}

/** Invisible helper frames injected by consent and tag managers; not part of the page. */
function isUtilityIframe(node) {
  if (node.tagName !== "iframe") return false;
  const cls = attrOf(node, "class") || "";
  const style = attrOf(node, "style") || "";
  return (
    attrOf(node, "aria-hidden") === "true" ||
    /hidden|offscreen/i.test(cls) ||
    /display:\s*none|visibility:\s*hidden/i.test(style) ||
    ["0", "1"].includes(attrOf(node, "width") || "") ||
    ["0", "1"].includes(attrOf(node, "height") || "")
  );
}

/** A <div> acting as the site header, navigation or footer (older markup has no landmark tags). */
function looksLikeLandmark(node) {
  const role = attrOf(node, "role") || "";
  if (["banner", "navigation", "contentinfo"].includes(role)) return true;
  const id = attrOf(node, "id") || "";
  const cls = attrOf(node, "class") || "";
  const re = /(^|[-_\s])(header|footer|navbar|gnav|globalnav|global-nav|global_nav)($|[-_\s])/i;
  return re.test(id) || re.test(cls);
}

/**
 * Decides which elements become components. Wrappers that merely hold the page
 * (a single root div, <main>, the div that contains most of the content) stay
 * in App so every component is one visible block of the page.
 */
function planBlocks(body) {
  const totalSize = markupSize(body);
  const walk = (node, depth) => {
    const kids = elementChildren(node);
    const items = [];
    for (const child of node.childNodes || []) {
      if (child.nodeName === "#text") {
        if (child.value.trim()) items.push({ type: "text", node: child });
        continue;
      }
      if (!isElement(child) || NON_RENDERED_TAGS.has(child.tagName)) continue;
      if (isUtilityIframe(child)) continue;
      const grandKids = elementChildren(child);
      const size = markupSize(child);
      const expandable = depth < 8 && grandKids.length >= 1;
      // Holds part of the page rather than being one block of it: <main>, an
      // only child, or a container too large to be a single block. Landmarks
      // (header, footer, nav) always stay whole.
      let isPageWrapper;
      const landmarkTag = ["header", "footer", "nav", "form", "aside"].includes(child.tagName);
      if (landmarkTag) isPageWrapper = false;
      else if (size > totalSize * 0.5 || child.tagName === "main" || kids.length === 1) isPageWrapper = true;
      else if (looksLikeLandmark(child)) isPageWrapper = false;
      else if (child.tagName === "section" || child.tagName === "article") isPageWrapper = size > totalSize * 0.4;
      else isPageWrapper = size > Math.max(8000, totalSize * 0.12);
      if (expandable && isPageWrapper) {
        items.push({ type: "wrapper", node: child, items: walk(child, depth + 1) });
      } else if (size < 240 && !SEMANTIC_BLOCK_TAGS.has(child.tagName)) {
        items.push({ type: "inline", node: child });
      } else {
        items.push({ type: "component", node: child });
      }
    }
    return items;
  };
  return walk(body, 0);
}

function pascalFromText(text) {
  const words = (text.match(/[A-Za-z][A-Za-z0-9]*/g) || []).slice(0, 4);
  if (words.length === 0) return "";
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
}

function nameComponents(items) {
  const used = new Set(["App"]);
  const components = [];
  let heroTaken = false;
  const visit = (list) => {
    for (const item of list) {
      if (item.type === "wrapper") {
        visit(item.items);
        continue;
      }
      if (item.type !== "component") continue;
      const node = item.node;
      const heading = findFirst(node, (n) => /^h[1-3]$/.test(n.tagName));
      const headingText = heading ? textOf(heading, 120) : "";
      let base = "";
      const hint = `${attrOf(node, "id") || ""} ${attrOf(node, "class") || ""} ${attrOf(node, "role") || ""}`;
      if (node.tagName === "header" || (!used.has("Header") && looksLikeLandmark(node) && /header|banner/i.test(hint))) base = "Header";
      else if (node.tagName === "footer" || (!used.has("Footer") && looksLikeLandmark(node) && /footer|contentinfo/i.test(hint))) base = "Footer";
      else if (node.tagName === "nav") base = "Nav";
      else if (!heroTaken && findFirst(node, (n) => n.tagName === "h1")) {
        base = "Hero";
        heroTaken = true;
      } else base = pascalFromText(headingText) || pascalFromText(attrOf(node, "id") || "") || "";
      if (!base || /^\d/.test(base)) base = "Section";
      let name = base;
      const index = components.length + 1;
      if (base === "Section" || used.has(name)) name = `${base}${String(index).padStart(2, "0")}`;
      while (used.has(name)) name += "b";
      used.add(name);
      item.name = name;
      item.index = index;
      item.summary = headingText || textOf(node, 90);
      components.push(item);
    }
  };
  visit(items);
  return components;
}

function tokenVariablesCss(tokens) {
  const bg = tokens.pageBackground || tokens.colors?.backgrounds?.[0]?.value || "#ffffff";
  const text = tokens.colors?.text?.[0]?.value || "#111111";
  const accent = tokens.colors?.accents?.[0]?.value || "#2563eb";
  const bodyFont = tokens.typography?.body?.fontFamily || "system-ui, sans-serif";
  const headingFont = tokens.typography?.h1?.fontFamily || bodyFont;
  return `/* Design tokens measured on the captured page. Variables only: nothing here
   changes how the page looks until you use them. */
:root {
  --site-bg: ${bg};
  --site-text: ${text};
  --site-accent: ${accent};
  --site-font-body: ${bodyFont};
  --site-font-heading: ${headingFont};
}
`;
}

function htmlAttrs(node, { skip = [] } = {}) {
  return (node.attrs || [])
    .filter((a) => !skip.includes(a.name) && !/^on/i.test(a.name))
    .map((a) => ` ${a.prefix ? a.prefix + ":" : ""}${a.name}="${a.value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`)
    .join("");
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) count += copyDirRecursive(s, d);
    else {
      fs.copyFileSync(s, d);
      count++;
    }
  }
  return count;
}

/**
 * Generates a project whose markup is the captured page split into its blocks.
 *   vanilla             – one index.html with every block labelled, plus the site CSS
 *   react-vite-tailwind – one React component per block, plus the site CSS
 * The structure and the styling are the real ones; behaviour (menus, sliders,
 * forms) is not carried over, because the page's scripts are not part of it.
 */
export function generateCleanProject({ evidenceDir, targetDir, mode, tokens = {}, copyAssets = true }) {
  const mirrorDir = path.join(evidenceDir, "mirror");
  const mirrorHtmlPath = path.join(mirrorDir, "index.html");
  if (!fs.existsSync(mirrorHtmlPath)) {
    throw new Error(`mirror/index.html not found in ${evidenceDir}. Capture with capture_mirror: true.`);
  }
  const isReact = mode === "react-vite-tailwind";
  const assetsTarget = isReact ? path.join(targetDir, "public", "assets") : path.join(targetDir, "assets");
  const assetPrefix = isReact ? "/assets/" : "./assets/";
  fs.mkdirSync(targetDir, { recursive: true });

  let copiedAssets = 0;
  if (copyAssets) copiedAssets = copyDirRecursive(path.join(evidenceDir, "assets"), assetsTarget);

  const document = parse(fs.readFileSync(mirrorHtmlPath, "utf8"));
  const html = document.childNodes.find((n) => n.tagName === "html");
  const head = html.childNodes.find((n) => n.tagName === "head");
  const body = html.childNodes.find((n) => n.tagName === "body");
  const extractedImages = extractInlineImages(body, assetsTarget);

  const fixUrl = (value) => value.split("../assets/").join(assetPrefix);
  // The stylesheet lives in styles/ (vanilla) or at the web root (React), so
  // its relative asset paths differ from the ones used in the markup.
  const cssAssetPrefix = isReact ? "/assets/" : "../assets/";
  const siteCss = fs.existsSync(path.join(mirrorDir, "styles.css"))
    ? fs.readFileSync(path.join(mirrorDir, "styles.css"), "utf8").split("../assets/").join(cssAssetPrefix)
    : "";

  // Utility frames are dropped from the static page as well.
  (function prune(node) {
    if (!node.childNodes) return;
    node.childNodes = node.childNodes.filter((c) => !(isElement(c) && isUtilityIframe(c)));
    node.childNodes.forEach(prune);
  })(body);

  const items = planBlocks(body);
  const components = nameComponents(items);
  const filesCreated = [];
  const write = (rel, content) => {
    const abs = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
    filesCreated.push(abs);
  };

  // Head: keep the page's own metadata, drop what the project replaces.
  head.childNodes = head.childNodes.filter((n) => {
    if (!isElement(n)) return true;
    if (n.tagName === "link") {
      const rel = (attrOf(n, "rel") || "").toLowerCase();
      if (/stylesheet|preconnect|dns-prefetch|preload|modulepreload|prefetch/.test(rel)) return false;
    }
    return !["script", "style", "noscript", "base"].includes(n.tagName);
  });
  const headInner = fixUrl(serialize(head)).trim();

  if (!isReact) {
    // Labels live inside comments so not a single text node is added to the page.
    for (const c of components) {
      const parent = c.node.parentNode;
      const at = parent.childNodes.indexOf(c.node);
      const label = `\n  ===== ${String(c.index).padStart(2, "0")} · ${c.name}${c.summary ? " — " + c.summary.replace(/--/g, "—").slice(0, 80) : ""} =====\n`;
      parent.childNodes.splice(at, 0, { nodeName: "#comment", data: label, parentNode: parent });
    }
    const bodyInner = fixUrl(serialize(body));
    write(
      "index.html",
      `<!DOCTYPE html>
<html${htmlAttrs(html)}>
<head>
${headInner}
<link rel="stylesheet" href="./styles/tokens.css" />
<link rel="stylesheet" href="./styles/site.css" />
</head>
<body${htmlAttrs(body)}>${bodyInner}
<script src="./scripts/main.js"></script>
</body>
</html>
`
    );
    write("styles/site.css", siteCss);
    write("styles/tokens.css", tokenVariablesCss(tokens));
    write(
      "scripts/main.js",
      `// The captured page's own scripts are not included. Behaviour (menus, tabs,
// sliders, forms) is written here against the markup in index.html.
`
    );
  } else {
    const jsxOpts = { rewriteUrl: fixUrl, rewriteCss: fixUrl };
    for (const c of components) {
      const jsx = elementToJsx(c.node, { ...jsxOpts, indent: 2 });
      write(
        `src/components/${c.name}.jsx`,
        `// Block ${c.index} of the captured page${c.summary ? ` — ${c.summary.replace(/\*\//g, "").slice(0, 100)}` : ""}
export default function ${c.name}() {
  return (
${jsx}
  );
}
`
      );
    }

    const renderItems = (list, depth) => {
      const pad = "  ".repeat(depth);
      const out = [];
      for (const item of list) {
        if (item.type === "component") out.push(`${pad}<${item.name} />`);
        else if (item.type === "inline") out.push(elementToJsx(item.node, { ...jsxOpts, indent: depth }));
        else if (item.type === "text") out.push(`${pad}{${JSON.stringify(item.node.value)}}`);
        else if (item.type === "wrapper") {
          const open = openTagSource(item.node, jsxOpts);
          const tag = item.node.tagName;
          out.push(`${pad}<${open}>\n${renderItems(item.items, depth + 1)}\n${pad}</${tag}>`);
        }
      }
      return out.join("\n");
    };
    const imports = components.map((c) => `import ${c.name} from "./components/${c.name}.jsx";`).join("\n");
    write(
      "src/App.jsx",
      `${imports}

// The page from top to bottom. Wrapper elements are kept exactly as captured
// because the site's CSS selects through them.
export default function App() {
  return (
    <>
${renderItems(items, 3)}
    </>
  );
}
`
    );
    write(
      "src/main.jsx",
      `import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/tailwind.css";
import App from "./App.jsx";

// Rendered straight into <body>: the site's CSS expects its blocks to be
// body's own children, with no extra root element in between.
createRoot(document.body).render(<App />);
`
    );
    write("src/styles/tokens.css", tokenVariablesCss(tokens));
    write(
      "src/styles/tailwind.css",
      `/* Tailwind for new work, kept out of the captured page's way:
   - no Preflight, because its reset would restyle the page;
   - prefixed, because the site has classes of its own named "container",
     "hidden", "flex"... which must not pick up Tailwind's rules.
   Write utilities as tw:mt-4, tw:flex; use tw:!mt-4 to win over site CSS. */
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme) prefix(tw);
@import "tailwindcss/utilities.css" layer(utilities) prefix(tw);
`
    );
    write("public/site.css", siteCss);
    write(
      "index.html",
      `<!DOCTYPE html>
<html${htmlAttrs(html)}>
<head>
${headInner}
<link rel="stylesheet" href="/site.css" />
<script type="module" src="/src/main.jsx"></script>
</head>
<body${htmlAttrs(body)}></body>
</html>
`
    );
    write(
      "package.json",
      JSON.stringify(
        {
          name: path.basename(targetDir).toLowerCase().replace(/[^a-z0-9-]/g, "-") || "cloned-site",
          private: true,
          version: "0.1.0",
          type: "module",
          scripts: { dev: "vite --host 127.0.0.1", build: "vite build", preview: "vite preview --host 127.0.0.1" },
          dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
          devDependencies: {
            "@tailwindcss/vite": "^4.0.0",
            "@vitejs/plugin-react": "^4.3.4",
            tailwindcss: "^4.0.0",
            vite: "^6.2.0",
          },
        },
        null,
        2
      ) + "\n"
    );
    write(
      "vite.config.js",
      `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
`
    );
  }

  return {
    filesCreated,
    copiedAssets,
    extractedImages,
    assetsPublicPrefix: assetPrefix,
    components: components.map((c) => ({ index: c.index, name: c.name, tag: c.node.tagName, summary: c.summary.slice(0, 80) })),
  };
}
