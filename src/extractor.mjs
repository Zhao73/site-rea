export async function extractDesignTokens(page) {
  return await page.evaluate(() => {
    function rgbToHex(str) {
      if (!str) return null;
      const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i);
      if (!m) return null;
      const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
      if (a === 0) return null;
      const r = Number(m[1]).toString(16).padStart(2, "0");
      const g = Number(m[2]).toString(16).padStart(2, "0");
      const b = Number(m[3]).toString(16).padStart(2, "0");
      if (a < 1) {
        return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${Number(a.toFixed(2))})`;
      }
      return `#${r}${g}${b}`.toLowerCase();
    }

    function luminance(hex) {
      if (!hex || !hex.startsWith("#") || hex.length !== 7) return null;
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    const bgCounts = new Map();
    const textCounts = new Map();
    const accentCounts = new Map();
    const borderCounts = new Map();
    const gradients = new Set();
    const radiiCounts = new Map();
    const shadowCounts = new Map();
    const containerWidths = new Map();

    const bump = (map, key, weight = 1) => {
      if (!key) return;
      map.set(key, (map.get(key) || 0) + weight);
    };

    const allEls = Array.from(document.querySelectorAll("body *")).slice(0, 1500);
    const bodyStyle = getComputedStyle(document.body);
    const htmlStyle = getComputedStyle(document.documentElement);
    const pageBg = rgbToHex(bodyStyle.backgroundColor) || rgbToHex(htmlStyle.backgroundColor) || "#ffffff";
    bump(bgCounts, pageBg, 100);

    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) continue;

      const areaWeight = Math.max(1, Math.min(20, Math.round((rect.width * rect.height) / 15000)));
      const bg = rgbToHex(s.backgroundColor);
      if (bg) bump(bgCounts, bg, areaWeight);

      const color = rgbToHex(s.color);
      if (color) bump(textCounts, color, 1);

      const tag = el.tagName.toLowerCase();
      if (tag === "button" || (tag === "a" && (bg || s.borderWidth !== "0px")) || el.getAttribute("role") === "button") {
        if (bg && bg !== pageBg) bump(accentCounts, bg, 5);
        if (color && color !== pageBg) bump(accentCounts, color, 2);
      }

      if (s.borderTopWidth && s.borderTopWidth !== "0px" && s.borderTopStyle !== "none") {
        const bc = rgbToHex(s.borderTopColor);
        if (bc) bump(borderCounts, bc, 1);
      }

      if (s.backgroundImage && s.backgroundImage.includes("gradient(")) {
        gradients.add(s.backgroundImage);
      }

      if (s.borderRadius && s.borderRadius !== "0px") {
        bump(radiiCounts, s.borderRadius, 1);
      }

      if (s.boxShadow && s.boxShadow !== "none") {
        bump(shadowCounts, s.boxShadow, 1);
      }

      if (s.maxWidth && s.maxWidth !== "none" && s.maxWidth.endsWith("px")) {
        const px = parseFloat(s.maxWidth);
        if (px >= 600 && px <= 1920) {
          bump(containerWidths, `${Math.round(px)}px`, 1);
        }
      }
    }

    const topEntries = (map, n = 12) =>
      Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([value, weight]) => ({ value, weight }));

    // Typography samples
    const typoTargets = [
      ["body", "body"],
      ["h1", "h1"],
      ["h2", "h2"],
      ["h3", "h3"],
      ["h4", "h4"],
      ["p", "p"],
      ["nav", "header a, nav a"],
      ["button", "button, a[class*='btn'], a[class*='button'], [role='button']"],
      ["code", "code, pre"],
    ];

    const typography = {};
    for (const [key, selector] of typoTargets) {
      const candidates = Array.from(document.querySelectorAll(selector));
      const visible = candidates.find((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden" && (el.innerText || "").trim().length > 0;
      });
      if (visible) {
        const s = getComputedStyle(visible);
        typography[key] = {
          fontFamily: s.fontFamily,
          fontSize: s.fontSize,
          fontWeight: s.fontWeight,
          lineHeight: s.lineHeight,
          letterSpacing: s.letterSpacing,
          color: rgbToHex(s.color) || s.color,
          textTransform: s.textTransform !== "none" ? s.textTransform : undefined,
          sampleText: (visible.innerText || "").trim().slice(0, 60),
        };
      }
    }

    // CSS custom properties, @font-face, and @keyframes
    const cssVariables = {};
    const fontFaces = [];
    const keyframes = [];
    const fontLinks = [];

    for (const link of Array.from(document.querySelectorAll("link[rel='stylesheet']"))) {
      const href = link.href || "";
      if (/fonts\.googleapis\.com|use\.typekit\.net|fonts\.bunny\.net|fontshare\.com|fonts\.cdnfonts\.com/i.test(href)) {
        fontLinks.push(href);
      }
    }

    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (rule.type === CSSRule.STYLE_RULE && /^(:root|html|body)\b/.test(rule.selectorText || "")) {
          for (let i = 0; i < rule.style.length; i++) {
            const prop = rule.style[i];
            if (prop.startsWith("--")) {
              const val = rule.style.getPropertyValue(prop).trim();
              if (val && Object.keys(cssVariables).length < 150) {
                cssVariables[prop] = val;
              }
            }
          }
        } else if (rule.type === CSSRule.FONT_FACE_RULE) {
          const family = rule.style.getPropertyValue("font-family").replace(/['"]/g, "").trim();
          const weight = rule.style.getPropertyValue("font-weight").trim() || "400";
          const style = rule.style.getPropertyValue("font-style").trim() || "normal";
          const src = rule.style.getPropertyValue("src").trim();
          if (family && fontFaces.length < 40) {
            fontFaces.push({ family, weight, style, src: src.slice(0, 300) });
          }
        } else if (rule.type === CSSRule.KEYFRAMES_RULE) {
          if (keyframes.length < 30) {
            keyframes.push({
              name: rule.name,
              cssText: rule.cssText.slice(0, 600),
            });
          }
        }
      }
    }

    const loadedFonts = Array.from(document.fonts || [])
      .filter((f) => f.status === "loaded")
      .map((f) => `${f.family.replace(/['"]/g, "")} (${f.weight} ${f.style})`);

    const meta = {
      title: document.title || "",
      lang: document.documentElement.lang || "en",
      description: document.querySelector("meta[name='description']")?.getAttribute("content") || "",
      ogTitle: document.querySelector("meta[property='og:title']")?.getAttribute("content") || "",
      ogDescription: document.querySelector("meta[property='og:description']")?.getAttribute("content") || "",
      ogImage: document.querySelector("meta[property='og:image']")?.getAttribute("content") || "",
      themeColor: document.querySelector("meta[name='theme-color']")?.getAttribute("content") || "",
      favicon:
        document.querySelector("link[rel='icon']")?.href ||
        document.querySelector("link[rel='shortcut icon']")?.href ||
        document.querySelector("link[rel='apple-touch-icon']")?.href ||
        new URL("/favicon.ico", location.href).href,
    };

    const pageBgLum = luminance(pageBg);
    const theme = pageBgLum !== null && pageBgLum < 0.35 ? "dark" : "light";

    return {
      meta,
      theme,
      pageBackground: pageBg,
      colors: {
        backgrounds: topEntries(bgCounts, 12),
        text: topEntries(textCounts, 10),
        accents: topEntries(accentCounts, 10),
        borders: topEntries(borderCounts, 8),
        gradients: Array.from(gradients).slice(0, 12),
      },
      typography,
      fonts: {
        links: Array.from(new Set(fontLinks)),
        loaded: Array.from(new Set(loadedFonts)).slice(0, 40),
        fontFaces,
      },
      layout: {
        containerWidths: topEntries(containerWidths, 6),
        borderRadii: topEntries(radiiCounts, 10),
        boxShadows: topEntries(shadowCounts, 8),
      },
      cssVariables,
      keyframes,
    };
  });
}

export async function extractBlueprintAndAssets(page, { maxSections = 25 } = {}) {
  return await page.evaluate((maxSec) => {
    function absUrl(raw) {
      if (!raw) return null;
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:") || trimmed.startsWith("javascript:") || trimmed.startsWith("#")) {
        return null;
      }
      try {
        return new URL(trimmed, location.href).href;
      } catch {
        return null;
      }
    }

    function bestFromSrcset(srcset) {
      if (!srcset) return null;
      const parts = srcset
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
        .map((entry) => {
          const [u, descriptor] = entry.split(/\s+/);
          let score = 1;
          if (descriptor) {
            if (descriptor.endsWith("w")) score = parseFloat(descriptor) || 1;
            else if (descriptor.endsWith("x")) score = (parseFloat(descriptor) || 1) * 1000;
          }
          return { url: absUrl(u), score };
        })
        .filter((e) => e.url);
      if (parts.length === 0) return null;
      parts.sort((a, b) => b.score - a.score);
      return parts[0].url;
    }

    function extractBgUrls(bgImage) {
      if (!bgImage || bgImage === "none") return [];
      const urls = [];
      const regex = /url\((['"]?)(.*?)\1\)/g;
      let match;
      while ((match = regex.exec(bgImage)) !== null) {
        const u = absUrl(match[2]);
        if (u) urls.push(u);
      }
      return urls;
    }

    function isVisible(el) {
      if (!el || el.nodeType !== 1) return false;
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    }

    function absRect(el) {
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.left + window.scrollX),
        y: Math.round(r.top + window.scrollY),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    }

    // 1. Intelligently find visual sections
    const docHeight = document.documentElement.scrollHeight;
    const viewportWidth = window.innerWidth;

    function unwrapRoot(container, depth = 0) {
      if (depth > 12) return [container];
      const children = Array.from(container.children).filter((c) => {
        const tag = c.tagName.toLowerCase();
        if (["script", "style", "noscript", "template", "link", "meta"].includes(tag)) return false;
        return isVisible(c);
      });
      if (children.length === 0) return [container];
      if (children.length === 1) {
        return unwrapRoot(children[0], depth + 1);
      }
      // If one child is <main> or wraps >50% of page height with multiple children inside, expand it
      const expanded = [];
      for (const child of children) {
        const tag = child.tagName.toLowerCase();
        const r = absRect(child);
        const childVisibleKids = Array.from(child.children).filter((c) => {
          const t = c.tagName.toLowerCase();
          return !["script", "style", "noscript", "template"].includes(t) && isVisible(c);
        });
        if (
          (tag === "main" || (tag === "div" && r.height > docHeight * 0.5 && childVisibleKids.length >= 2)) &&
          depth < 9
        ) {
          expanded.push(...unwrapRoot(child, depth + 1));
        } else {
          expanded.push(child);
        }
      }
      return expanded;
    }

    let rawSections = unwrapRoot(document.body).filter((el) => {
      const r = absRect(el);
      return r.height >= 28 && r.width >= viewportWidth * 0.25;
    });

    // Deduplicate overlapping ancestors and sort by vertical position
    rawSections = rawSections
      .filter((el, idx, arr) => !arr.some((other, oIdx) => oIdx !== idx && other.contains(el)))
      .sort((a, b) => absRect(a).y - absRect(b).y);

    // Fallback if segmentation collapsed into 0 or 1 huge block
    if (rawSections.length === 0) {
      rawSections = [document.body];
    }

    // Cap section count cleanly
    if (rawSections.length > maxSec) {
      rawSections = rawSections.slice(0, maxSec);
    }

    const assetMap = new Map();
    const inlineSvgs = [];
    const registerAsset = (url, type, meta = {}) => {
      if (!url) return;
      if (!assetMap.has(url)) {
        assetMap.set(url, { url, type, ...meta, usedInSections: new Set() });
      }
      if (meta.sectionIndex !== undefined) {
        assetMap.get(url).usedInSections.add(meta.sectionIndex);
      }
    };

    // Register favicon & OG image
    const fav =
      document.querySelector("link[rel='icon']")?.href ||
      document.querySelector("link[rel='shortcut icon']")?.href ||
      document.querySelector("link[rel='apple-touch-icon']")?.href;
    if (fav) registerAsset(absUrl(fav), "image", { role: "favicon" });
    const ogImg = document.querySelector("meta[property='og:image']")?.getAttribute("content");
    if (ogImg) registerAsset(absUrl(ogImg), "image", { role: "og-image" });

    // Extract semantic blueprint for each section
    function compactStyles(el) {
      const s = getComputedStyle(el);
      const out = {};
      if (s.display && s.display !== "block" && s.display !== "inline") out.display = s.display;
      if (s.display === "flex" || s.display === "inline-flex") {
        out.flexDirection = s.flexDirection;
        if (s.justifyContent !== "normal") out.justifyContent = s.justifyContent;
        if (s.alignItems !== "normal") out.alignItems = s.alignItems;
        if (s.gap && s.gap !== "normal" && s.gap !== "0px") out.gap = s.gap;
      }
      if (s.display === "grid" || s.display === "inline-grid") {
        if (s.gridTemplateColumns && s.gridTemplateColumns !== "none") out.gridTemplateColumns = s.gridTemplateColumns;
        if (s.gap && s.gap !== "normal" && s.gap !== "0px") out.gap = s.gap;
      }
      if (s.backgroundColor && s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent") {
        out.backgroundColor = s.backgroundColor;
      }
      if (s.backgroundImage && s.backgroundImage !== "none") {
        out.backgroundImage = s.backgroundImage.slice(0, 260);
      }
      if (s.color) out.color = s.color;
      if (s.fontSize) out.fontSize = s.fontSize;
      if (s.fontWeight && s.fontWeight !== "400") out.fontWeight = s.fontWeight;
      if (s.padding && s.padding !== "0px") out.padding = s.padding;
      if (s.borderRadius && s.borderRadius !== "0px") out.borderRadius = s.borderRadius;
      if (s.position && s.position !== "static") out.position = s.position;
      return out;
    }

    function walkNode(el, sectionIndex, depth = 0, budget = { count: 0 }) {
      if (!el || el.nodeType !== 1 || depth > 10 || budget.count > 160) return null;
      const tag = el.tagName.toLowerCase();
      if (["script", "style", "noscript", "template", "meta", "link"].includes(tag)) return null;
      if (!isVisible(el)) return null;

      budget.count++;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();

      // Background images
      const bgUrls = extractBgUrls(s.backgroundImage);
      for (const u of bgUrls) {
        registerAsset(u, "image", { sectionIndex, role: "background" });
      }

      // Inline SVG
      if (tag === "svg") {
        const svgIndex = inlineSvgs.length;
        const svgId = `svg-${String(svgIndex + 1).padStart(3, "0")}`;
        const clone = el.cloneNode(true);
        if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        if (!clone.getAttribute("viewBox") && r.width > 0 && r.height > 0) {
          clone.setAttribute("viewBox", `0 0 ${Math.round(r.width)} ${Math.round(r.height)}`);
        }
        // Preserve currentColor if fill uses it
        const computedColor = s.color;
        inlineSvgs.push({
          id: svgId,
          width: Math.round(r.width),
          height: Math.round(r.height),
          color: computedColor,
          sectionIndex,
          markup: clone.outerHTML.slice(0, 40000),
        });
        return {
          tag: "svg",
          svgId,
          width: Math.round(r.width),
          height: Math.round(r.height),
          color: computedColor,
          ariaLabel: el.getAttribute("aria-label") || undefined,
        };
      }

      // Image
      if (tag === "img") {
        const src = bestFromSrcset(el.getAttribute("srcset")) || absUrl(el.currentSrc || el.getAttribute("src") || el.getAttribute("data-src"));
        if (src) {
          registerAsset(src, "image", {
            sectionIndex,
            alt: el.getAttribute("alt") || "",
            naturalWidth: el.naturalWidth || Math.round(r.width),
            naturalHeight: el.naturalHeight || Math.round(r.height),
          });
        }
        return {
          tag: "img",
          src: src || el.getAttribute("src") || "",
          alt: el.getAttribute("alt") || "",
          width: Math.round(r.width),
          height: Math.round(r.height),
          objectFit: s.objectFit !== "fill" ? s.objectFit : undefined,
          borderRadius: s.borderRadius !== "0px" ? s.borderRadius : undefined,
        };
      }

      // Video
      if (tag === "video") {
        const poster = absUrl(el.getAttribute("poster"));
        const sourceSrc = absUrl(el.currentSrc || el.getAttribute("src") || el.querySelector("source")?.getAttribute("src"));
        if (poster) registerAsset(poster, "image", { sectionIndex, role: "video-poster" });
        if (sourceSrc) registerAsset(sourceSrc, "video", { sectionIndex, role: "video" });
        return {
          tag: "video",
          src: sourceSrc || undefined,
          poster: poster || undefined,
          width: Math.round(r.width),
          height: Math.round(r.height),
          autoplay: el.autoplay || undefined,
          loop: el.loop || undefined,
          muted: el.muted || undefined,
        };
      }

      // Direct text
      const directText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" ")
        .slice(0, 600);

      const children = [];
      for (const child of Array.from(el.children)) {
        const cNode = walkNode(child, sectionIndex, depth + 1, budget);
        if (cNode) children.push(cNode);
      }

      // Skip purely empty wrapper divs unless they have a background/border/image/text
      const isSemantic = ["header", "nav", "main", "section", "article", "aside", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "p", "a", "button", "ul", "ol", "li", "form", "input", "textarea", "select", "label", "table", "figure", "blockquote"].includes(tag);
      if (!isSemantic && !directText && bgUrls.length === 0 && children.length === 1) {
        // Collapse redundant layout wrapper if it has no visual styling of its own
        const st = compactStyles(el);
        const hasVisual = st.backgroundColor || st.backgroundImage || st.display === "grid" || st.display === "flex" || st.borderRadius;
        if (!hasVisual) {
          return children[0];
        }
      }
      if (!isSemantic && !directText && bgUrls.length === 0 && children.length === 0) {
        return null;
      }

      const node = { tag };
      if (el.id) node.id = el.id;
      if (directText) node.text = directText;
      if (tag === "a") node.href = el.getAttribute("href") || "";
      if (tag === "input" || tag === "textarea" || tag === "select") {
        node.inputType = el.getAttribute("type") || tag;
        if (el.getAttribute("placeholder")) node.placeholder = el.getAttribute("placeholder");
        if (el.getAttribute("name")) node.name = el.getAttribute("name");
      }
      if (el.getAttribute("role")) node.role = el.getAttribute("role");
      if (bgUrls.length > 0) node.backgroundUrls = bgUrls;

      if (depth <= 4 || ["h1", "h2", "h3", "h4", "p", "a", "button", "header", "nav", "section", "footer"].includes(tag)) {
        node.styles = compactStyles(el);
      }
      if (children.length > 0) node.children = children;
      return node;
    }

    function guessSectionRole(el, index, total, box) {
      const tag = el.tagName.toLowerCase();
      const cls = `${el.id || ""} ${typeof el.className === "string" ? el.className : ""}`.toLowerCase();
      if (tag === "header" || tag === "nav" || (index === 0 && box.height < 160 && el.querySelectorAll("a").length >= 2)) return "header";
      if (tag === "footer" || (index === total - 1 && (cls.includes("footer") || box.y > docHeight * 0.7))) return "footer";
      if (index <= 1 && box.y < 300 && (el.querySelector("h1") || cls.includes("hero"))) return "hero";
      if (cls.includes("pricing") || cls.includes("plan")) return "pricing";
      if (cls.includes("faq") || cls.includes("accordion")) return "faq";
      if (cls.includes("testimonial") || cls.includes("review")) return "testimonials";
      if (cls.includes("feature")) return "features";
      if (cls.includes("cta")) return "cta";
      return "section";
    }

    const sections = rawSections.map((el, idx) => {
      const box = absRect(el);
      const role = guessSectionRole(el, idx, rawSections.length, box);
      const heading = (el.querySelector("h1, h2, h3")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 100);
      const textPreview = (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 180);
      const tree = walkNode(el, idx, 0, { count: 0 });
      return {
        index: idx,
        role,
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        heading: heading || null,
        textPreview,
        boundingBox: box,
        styles: compactStyles(el),
        tree,
      };
    });

    // Discover interactive hints
    const interactiveHints = {
      buttons: Array.from(document.querySelectorAll("button, [role='button'], a[class*='btn'], a[class*='button']"))
        .filter(isVisible)
        .slice(0, 30)
        .map((el) => ({
          text: (el.innerText || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 80),
          tag: el.tagName.toLowerCase(),
          href: el.getAttribute("href") || undefined,
        })),
      tabs: document.querySelectorAll("[role='tablist'], [role='tab']").length,
      accordions: document.querySelectorAll("details, [aria-expanded]").length,
      forms: Array.from(document.querySelectorAll("form"))
        .filter(isVisible)
        .slice(0, 10)
        .map((f) => ({
          action: f.getAttribute("action") || "",
          method: f.getAttribute("method") || "get",
          fields: Array.from(f.querySelectorAll("input, textarea, select")).map((i) => ({
            type: i.getAttribute("type") || i.tagName.toLowerCase(),
            name: i.getAttribute("name") || "",
            placeholder: i.getAttribute("placeholder") || "",
          })),
        })),
      hasCarousels: Boolean(document.querySelector("[class*='swiper'], [class*='slick'], [class*='carousel'], [class*='slider'], [aria-roledescription='carousel']")),
      hasStickyHeader: Array.from(document.querySelectorAll("header, nav")).some((el) => {
        const p = getComputedStyle(el).position;
        return p === "fixed" || p === "sticky";
      }),
    };

    // Discover internal same-origin routes
    const routeMap = new Map();
    const origin = location.origin;
    for (const a of Array.from(document.querySelectorAll("a[href]"))) {
      const rawHref = a.getAttribute("href");
      const full = absUrl(rawHref);
      if (!full) continue;
      let parsed;
      try {
        parsed = new URL(full);
      } catch {
        continue;
      }
      if (parsed.origin !== origin) continue;
      const pathname = parsed.pathname || "/";
      if (/\.(png|jpg|jpeg|webp|svg|pdf|zip|mp4|css|js)$/i.test(pathname)) continue;
      const zone = a.closest("header, nav") ? "nav" : a.closest("footer") ? "footer" : "body";
      const label = (a.innerText || a.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (!routeMap.has(pathname)) {
        routeMap.set(pathname, { pathname, url: `${origin}${pathname}`, label, zones: [zone] });
      } else {
        const entry = routeMap.get(pathname);
        if (!entry.zones.includes(zone)) entry.zones.push(zone);
        if (!entry.label && label) entry.label = label;
      }
    }

    // Collect font asset URLs from CSS @font-face
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (rule.type === CSSRule.FONT_FACE_RULE) {
          const src = rule.style.getPropertyValue("src") || "";
          const regex = /url\((['"]?)(.*?)\1\)/g;
          let m;
          while ((m = regex.exec(src)) !== null) {
            const baseHref = sheet.href || location.href;
            try {
              const resolved = new URL(m[2], baseHref).href;
              if (resolved.startsWith("http")) {
                registerAsset(resolved, "font", { role: "font" });
              }
            } catch {}
          }
        }
      }
    }

    const assets = Array.from(assetMap.values()).map((a) => ({
      ...a,
      usedInSections: Array.from(a.usedInSections),
    }));

    return {
      url: location.href,
      origin,
      documentSize: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      },
      sections,
      interactiveHints,
      routes: Array.from(routeMap.values()).slice(0, 120),
      assets,
      inlineSvgs,
    };
  }, maxSections);
}

export async function extractFrozenMirror(page) {
  return await page.evaluate(() => {
    // The page's CSS, in cascade order. Each sheet keeps its media condition
    // (a print stylesheet must stay a print stylesheet), @import is followed,
    // and a sheet the browser will not let us read (cross-origin) keeps its
    // place in the order so it can be fetched and inserted right there.
    const cssChunks = [];
    const wrapMedia = (cssText, mediaText) =>
      mediaText && mediaText !== "all" ? `@media ${mediaText} {\n${cssText}\n}` : cssText;
    const readSheet = (sheet, inheritedMedia, depth) => {
      if (!sheet || sheet.disabled || depth > 6) return;
      const own = sheet.media && sheet.media.mediaText ? sheet.media.mediaText : "";
      const media = [inheritedMedia, own].filter((m) => m && m !== "all").join(" and ");
      let rules;
      try {
        rules = Array.from(sheet.cssRules || []);
      } catch {
        if (sheet.href) cssChunks.push({ kind: "external", href: sheet.href, media });
        return;
      }
      let buffer = [];
      const flush = () => {
        if (buffer.length === 0) return;
        cssChunks.push({ kind: "inline", href: sheet.href || location.href, media, cssText: buffer.join("\n") });
        buffer = [];
      };
      for (const rule of rules) {
        if (rule.type === CSSRule.IMPORT_RULE) {
          flush();
          const importMedia = rule.media && rule.media.mediaText ? rule.media.mediaText : "";
          const combined = [media, importMedia].filter((m) => m && m !== "all").join(" and ");
          if (rule.styleSheet) readSheet(rule.styleSheet, combined, depth + 1);
          else if (rule.href) cssChunks.push({ kind: "external", href: new URL(rule.href, sheet.href || location.href).href, media: combined });
          continue;
        }
        buffer.push(rule.cssText);
      }
      flush();
    };
    for (const sheet of Array.from(document.styleSheets)) readSheet(sheet, "", 0);
    // Sheets attached from script (design systems, CSS-in-JS) cascade after the document's own.
    for (const sheet of Array.from(document.adoptedStyleSheets || [])) readSheet(sheet, "", 0);
    for (const chunk of cssChunks) {
      if (chunk.kind === "inline") chunk.cssText = wrapMedia(chunk.cssText, chunk.media);
    }

    // Clone the rendered DOM and freeze image src/srcset to absolute URLs
    const docClone = document.documentElement.cloneNode(true);

    // Remove scripts, preload hints, and existing stylesheet links (we will inject consolidated CSS)
    for (const el of Array.from(
      docClone.querySelectorAll(
        "script, noscript, link[rel='preload'], link[rel='modulepreload'], link[rel='stylesheet'], style"
      )
    )) {
      el.remove();
    }

    // Resolve relative URLs in img/source/a/video/link[rel*='icon'] and inline style="url(...)"
    const resolveAttr = (el, attr) => {
      const val = el.getAttribute(attr);
      if (
        !val ||
        val.startsWith("data:") ||
        val.startsWith("blob:") ||
        val.startsWith("#") ||
        val.startsWith("mailto:") ||
        val.startsWith("tel:")
      ) {
        return;
      }
      try {
        el.setAttribute(attr, new URL(val, location.href).href);
      } catch {}
    };

    const resolveInlineStyleUrls = (el) => {
      const styleAttr = el.getAttribute("style");
      if (!styleAttr || !styleAttr.includes("url(")) return;
      const rewritten = styleAttr.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (full, q, raw) => {
        const trimmed = (raw || "").trim();
        if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("#")) return full;
        try {
          return `url("${new URL(trimmed, location.href).href}")`;
        } catch {
          return full;
        }
      });
      el.setAttribute("style", rewritten);
    };

    // Sync live resolved image sources, canvas pixels, and form values before stripping <picture> sources
    const origEls = Array.from(document.body.querySelectorAll("*"));
    const cloneEls = Array.from(docClone.querySelector("body")?.querySelectorAll("*") || []);
    const count = Math.min(origEls.length, cloneEls.length);
    for (let i = 0; i < count; i++) {
      const orig = origEls[i];
      const cloned = cloneEls[i];
      if (orig.tagName === "IMG") {
        if (orig.currentSrc && !orig.currentSrc.startsWith("data:")) {
          cloned.setAttribute("src", orig.currentSrc);
        }
        cloned.removeAttribute("srcset");
        cloned.removeAttribute("loading");
      } else if (orig.tagName === "CANVAS") {
        try {
          const dataUrl = orig.toDataURL("image/png");
          const imgEl = document.createElement("img");
          imgEl.setAttribute("src", dataUrl);
          imgEl.setAttribute("class", orig.getAttribute("class") || "");
          imgEl.setAttribute("style", orig.getAttribute("style") || "");
          cloned.replaceWith(imgEl);
        } catch {}
      } else if (orig.tagName === "INPUT" && orig.value) {
        cloned.setAttribute("value", orig.value);
      }
    }

    // Flatten <picture> <source> elements so browser uses the localized <img src>
    for (const picSource of Array.from(docClone.querySelectorAll("picture source"))) {
      picSource.remove();
    }
    for (const img of Array.from(docClone.querySelectorAll("img"))) {
      if (!img.getAttribute("src") && img.getAttribute("data-src")) {
        img.setAttribute("src", img.getAttribute("data-src"));
      }
      resolveAttr(img, "src");
      img.removeAttribute("srcset");
      img.removeAttribute("loading");
    }
    for (const source of Array.from(docClone.querySelectorAll("source"))) {
      resolveAttr(source, "src");
      source.removeAttribute("srcset");
    }
    for (const video of Array.from(docClone.querySelectorAll("video"))) {
      resolveAttr(video, "src");
      resolveAttr(video, "poster");
    }
    for (const link of Array.from(docClone.querySelectorAll("link[rel*='icon']"))) {
      resolveAttr(link, "href");
    }
    for (const styled of Array.from(docClone.querySelectorAll("[style]"))) {
      resolveInlineStyleUrls(styled);
    }

    return {
      baseUrl: location.href,
      doctype: "<!DOCTYPE html>",
      html: docClone.outerHTML,
      cssChunks,
    };
  });
}
