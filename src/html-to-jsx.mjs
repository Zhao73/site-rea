/**
 * Converts parsed HTML (parse5 nodes) into JSX source that renders the same DOM.
 */

const ATTR_RENAMES = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  readonly: "readOnly",
  maxlength: "maxLength",
  minlength: "minLength",
  colspan: "colSpan",
  rowspan: "rowSpan",
  crossorigin: "crossOrigin",
  autoplay: "autoPlay",
  playsinline: "playsInline",
  srcset: "srcSet",
  autocomplete: "autoComplete",
  autofocus: "autoFocus",
  autocapitalize: "autoCapitalize",
  autocorrect: "autoCorrect",
  enctype: "encType",
  frameborder: "frameBorder",
  allowfullscreen: "allowFullScreen",
  novalidate: "noValidate",
  formnovalidate: "formNoValidate",
  datetime: "dateTime",
  contenteditable: "contentEditable",
  spellcheck: "spellCheck",
  usemap: "useMap",
  cellpadding: "cellPadding",
  cellspacing: "cellSpacing",
  charset: "charSet",
  "http-equiv": "httpEquiv",
  "accept-charset": "acceptCharset",
  inputmode: "inputMode",
  enterkeyhint: "enterKeyHint",
  fetchpriority: "fetchPriority",
  referrerpolicy: "referrerPolicy",
  srcdoc: "srcDoc",
  srclang: "srcLang",
  formaction: "formAction",
  hreflang: "hrefLang",
  itemprop: "itemProp",
  itemscope: "itemScope",
  itemtype: "itemType",
  itemid: "itemID",
  itemref: "itemRef",
  nomodule: "noModule",
  controlslist: "controlsList",
  disablepictureinpicture: "disablePictureInPicture",
  disableremoteplayback: "disableRemotePlayback",
  popovertarget: "popoverTarget",
  popovertargetaction: "popoverTargetAction",
  accesskey: "accessKey",
  marginheight: "marginHeight",
  marginwidth: "marginWidth",
  imagesizes: "imageSizes",
  imagesrcset: "imageSrcSet",
};

const BOOLEAN_ATTRS = new Set([
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "disablepictureinpicture",
  "disableremoteplayback",
  "scoped",
  "seamless",
  "inert",
  "ismap",
  "itemscope",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "selected",
]);

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// Elements whose markup never becomes part of a component.
const DROP_TAGS = new Set(["script", "noscript", "style", "template", "link", "meta", "base", "title"]);
const PRESERVE_WHITESPACE_TAGS = new Set(["pre", "textarea"]);
const SVG_NS = "http://www.w3.org/2000/svg";

function camelCase(name) {
  return name.replace(/[-:]([a-z0-9])/gi, (_, c) => c.toUpperCase());
}

function splitDeclarations(styleText) {
  // Split on ";" that is not inside parentheses or quotes (data: URLs contain both).
  const out = [];
  let depth = 0;
  let quote = null;
  let current = "";
  for (const ch of styleText) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
    } else if (ch === ";" && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current);
  return out;
}

export function styleToObjectLiteral(styleText) {
  const props = [];
  for (const decl of splitDeclarations(styleText)) {
    const colon = decl.indexOf(":");
    if (colon === -1) continue;
    const rawName = decl.slice(0, colon).trim();
    const value = decl.slice(colon + 1).trim();
    if (!rawName || !value) continue;
    let key;
    const cleanValue = value;
    if (rawName.startsWith("--")) {
      key = JSON.stringify(rawName);
    } else {
      const lower = rawName.toLowerCase();
      // -webkit-foo -> WebkitFoo, -ms-foo -> msFoo (React's naming for vendor prefixes)
      const camel = lower.startsWith("-ms-")
        ? "ms" + camelCase(lower.slice(3))
        : camelCase(lower.replace(/^-/, "X-")).replace(/^X/, "");
      key = /^[A-Za-z_$][\w$]*$/.test(camel) ? camel : JSON.stringify(camel);
    }
    props.push(`${key}: ${JSON.stringify(cleanValue)}`);
  }
  return props.length > 0 ? `{{ ${props.join(", ")} }}` : null;
}

function attrValueSource(value) {
  // A plain JSX string attribute decodes entities and cannot hold quotes or newlines.
  return /^[^"\\&{}\n\r<>]*$/.test(value) ? `"${value}"` : `{${JSON.stringify(value)}}`;
}

function jsxText(text, preserve) {
  // Collapsible whitespace renders as one space; a non-breaking space does not collapse.
  if (!preserve && /^[ \t\n\r\f]+$/.test(text)) return '{" "}';
  if (/^[^{}<>&\s][^{}<>&\n\r\t]*[^{}<>&\s]$|^[^{}<>&\s]$/.test(text)) return text;
  return `{${JSON.stringify(text)}}`;
}

function isElement(node) {
  return node && typeof node.tagName === "string";
}

function selectedOptionValue(selectNode) {
  const stack = [...(selectNode.childNodes || [])];
  while (stack.length > 0) {
    const n = stack.shift();
    if (!isElement(n)) continue;
    if (n.tagName === "option" && n.attrs.some((a) => a.name === "selected")) {
      const v = n.attrs.find((a) => a.name === "value");
      if (v) return v.value;
      const t = (n.childNodes || []).find((c) => c.nodeName === "#text");
      return t ? t.value : "";
    }
    stack.unshift(...(n.childNodes || []));
  }
  return null;
}

/**
 * @param {object} node parse5 element
 * @param {object} opts
 * @param {(value: string, attr: string, tag: string) => string} [opts.rewriteUrl] rewrites asset URLs
 * @param {number} [opts.indent]
 */
export function elementToJsx(node, opts = {}, depth = 0, ctx = { preserve: false }) {
  const pad = "  ".repeat((opts.indent || 0) + depth);
  if (node.nodeName === "#text") {
    const text = jsxText(node.value, ctx.preserve);
    return text ? pad + text : "";
  }
  if (!isElement(node)) return "";
  const isSvg = node.namespaceURI === SVG_NS;
  // <title> inside an SVG is its accessible name, not the document title.
  if (DROP_TAGS.has(node.tagName) && !(isSvg && node.tagName === "title")) return "";

  const tag = node.tagName;
  const isCustomElement = tag.includes("-");
  const attrs = [];
  const spread = {};
  let textareaValue = null;

  for (const attr of node.attrs || []) {
    const rawName = attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name;
    const lower = rawName.toLowerCase();
    let value = attr.value;

    if (/^on[a-z]+$/.test(lower)) continue; // inline handlers are strings, not functions
    if (lower === "key" || lower === "ref") continue;

    if (lower === "style") {
      const cssText = opts.rewriteCss ? opts.rewriteCss(value) : value;
      if (/!\s*important/i.test(cssText)) {
        // React sets styles as properties, which silently drop "!important".
        // Such a style is applied as text so it keeps its priority.
        attrs.push(`ref={(el) => { if (el) el.style.cssText = ${JSON.stringify(cssText)}; }}`);
      } else {
        const obj = styleToObjectLiteral(cssText);
        if (obj) attrs.push(`style=${obj}`);
      }
      continue;
    }
    // React refuses javascript: URLs; the behaviour they stood for is not carried over anyway.
    if ((lower === "href" || lower === "action") && /^\s*javascript:/i.test(value)) value = "#";
    if (opts.rewriteUrl && ["src", "href", "poster", "srcset", "data", "xlink:href", "action"].includes(lower)) {
      value = opts.rewriteUrl(value, lower, tag);
    }

    if (!isSvg && !isCustomElement) {
      if (tag === "option" && lower === "selected") continue;
      if ((tag === "input" || tag === "select") && lower === "value") {
        attrs.push(`defaultValue=${attrValueSource(value)}`);
        continue;
      }
      if (tag === "input" && lower === "checked") {
        attrs.push("defaultChecked");
        continue;
      }
      if (BOOLEAN_ATTRS.has(lower) || (lower === "hidden" && (value === "" || value === "hidden"))) {
        // React drops a boolean attribute given as "", so <div hidden=""> would become visible.
        attrs.push(ATTR_RENAMES[lower] || lower);
        continue;
      }
    }

    let name;
    if (lower.startsWith("data-") || lower.startsWith("aria-")) {
      name = lower;
    } else if (isSvg) {
      // parse5 already restores SVG's mixed-case names (viewBox); hyphens and
      // namespaces become camelCase (stroke-width -> strokeWidth, xlink:href -> xlinkHref).
      name = rawName === "class" ? "className" : /[-:]/.test(rawName) ? camelCase(rawName) : rawName;
    } else if (isCustomElement) {
      name = rawName === "class" ? "className" : rawName;
    } else {
      name = ATTR_RENAMES[lower] || rawName;
    }

    if (!/^[A-Za-z_][\w-]*$/.test(name)) {
      // Names JSX cannot spell (@click, :class, x-on:click) go through a spread.
      spread[rawName] = value;
      continue;
    }
    attrs.push(`${name}=${attrValueSource(value)}`);
  }

  if (tag === "select") {
    const selected = selectedOptionValue(node);
    if (selected !== null) attrs.push(`defaultValue=${attrValueSource(selected)}`);
  }
  if (tag === "textarea") {
    textareaValue = (node.childNodes || []).map((c) => (c.nodeName === "#text" ? c.value : "")).join("");
    if (textareaValue) attrs.push(`defaultValue={${JSON.stringify(textareaValue)}}`);
  }
  if (Object.keys(spread).length > 0) attrs.push(`{...${JSON.stringify(spread)}}`);

  const open = attrs.length > 0 ? `${tag} ${attrs.join(" ")}` : tag;
  const sourceChildren =
    tag === "template" && node.content ? node.content.childNodes : node.childNodes || [];
  if (VOID_TAGS.has(tag) || tag === "textarea") return `${pad}<${open} />`;

  const childCtx = { preserve: ctx.preserve || PRESERVE_WHITESPACE_TAGS.has(tag) };
  const children = [];
  for (const child of sourceChildren) {
    if (child.nodeName === "#comment" || child.nodeName === "#documentType") continue;
    const src = elementToJsx(child, opts, depth + 1, childCtx);
    if (src) children.push(src);
  }
  if (children.length === 0) return `${pad}<${open} />`;
  return `${pad}<${open}>\n${children.join("\n")}\n${pad}</${tag}>`;
}

/** Attribute list of an element as a JSX opening-tag fragment (used for wrappers in App). */
export function openTagSource(node, opts = {}) {
  const shell = { ...node, childNodes: [] };
  const src = elementToJsx(shell, { ...opts, indent: 0 }, 0);
  // "<div a=b />" -> "div a=b"
  return src.trim().replace(/^</, "").replace(/\s*\/>$/, "");
}
