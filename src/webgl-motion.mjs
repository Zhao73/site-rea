import fs from "node:fs";
import path from "node:path";
import { launchBrowser, detectBlockedPage, scrollAndSettlePage } from "./browser.mjs";
import { buildDeterministicClockInitScript, lockDeterministicFrame, getEvidenceClock, FIRST_LOCK_MS } from "./deterministic-clock.mjs";

/**
 * Injected via page.addInitScript BEFORE page JS executes.
 * Strictly read-only instrumentation: records WebGL/WebGL2 GLSL shader sources,
 * uniform names/samples, and canvas creation without altering rendering output.
 */
export const WEBGL_MOTION_INIT_SCRIPT = `(() => {
  if (window.__SITE_REA_HOOKED__) return;
  window.__SITE_REA_HOOKED__ = true;

  const store = {
    shaders: [],
    programs: [],
    uniforms: {},
    contexts: [],
    webgpu: {
      supported: typeof navigator !== "undefined" && Boolean(navigator.gpu),
      canvasConfigs: [],
      shaders: [],
      renderPipelines: [],
      computePipelines: [],
    },
  };
  window.__SITE_REA_WEBGL__ = store;

  const MAX_SHADERS = 80;
  const MAX_UNIFORMS = 120;
  const MAX_WGSL = 80;
  const MAX_PIPELINES = 80;

  function patchContextProto(Proto, kind) {
    if (!Proto || Proto.__siteReaPatched) return;
    Proto.__siteReaPatched = true;

    const origShaderSource = Proto.shaderSource;
    if (typeof origShaderSource === "function") {
      Proto.shaderSource = function (shader, source) {
        try {
          if (store.shaders.length < MAX_SHADERS && typeof source === "string") {
            let shaderType = "unknown";
            try {
              const t = this.getShaderParameter(shader, this.SHADER_TYPE);
              if (t === this.VERTEX_SHADER) shaderType = "vertex";
              else if (t === this.FRAGMENT_SHADER) shaderType = "fragment";
            } catch {}
            const trimmed = source.trim();
            const exists = store.shaders.some((s) => s.source === trimmed && s.type === shaderType);
            if (!exists && trimmed.length > 0) {
              store.shaders.push({
                index: store.shaders.length,
                context: kind,
                type: shaderType,
                source: trimmed.slice(0, 60000),
              });
            }
          }
        } catch {}
        return origShaderSource.call(this, shader, source);
      };
    }

    const locToName = new WeakMap();
    const origGetUniformLocation = Proto.getUniformLocation;
    if (typeof origGetUniformLocation === "function") {
      Proto.getUniformLocation = function (program, name) {
        const loc = origGetUniformLocation.call(this, program, name);
        try {
          if (loc && typeof name === "string") {
            locToName.set(loc, name);
            if (Object.keys(store.uniforms).length < MAX_UNIFORMS && !(name in store.uniforms)) {
              store.uniforms[name] = null;
            }
          }
        } catch {}
        return loc;
      };
    }

    function wrapUniformSetter(methodName, formatter) {
      const orig = Proto[methodName];
      if (typeof orig !== "function") return;
      Proto[methodName] = function (loc, ...args) {
        try {
          const name = loc ? locToName.get(loc) : null;
          if (name && Object.keys(store.uniforms).length <= MAX_UNIFORMS) {
            store.uniforms[name] = formatter(args);
          }
        } catch {}
        return orig.apply(this, [loc, ...args]);
      };
    }

    wrapUniformSetter("uniform1f", (a) => Number(Number(a[0]).toFixed(4)));
    wrapUniformSetter("uniform2f", (a) => [Number(a[0]), Number(a[1])].map((n) => Number(n.toFixed(4))));
    wrapUniformSetter("uniform3f", (a) => [Number(a[0]), Number(a[1]), Number(a[2])].map((n) => Number(n.toFixed(4))));
    wrapUniformSetter("uniform4f", (a) => [Number(a[0]), Number(a[1]), Number(a[2]), Number(a[3])].map((n) => Number(n.toFixed(4))));
    wrapUniformSetter("uniform1i", (a) => a[0]);
    wrapUniformSetter("uniform2fv", (a) => Array.from(a[0] || []).slice(0, 4).map((n) => Number(Number(n).toFixed(4))));
    wrapUniformSetter("uniform3fv", (a) => Array.from(a[0] || []).slice(0, 4).map((n) => Number(Number(n).toFixed(4))));
    wrapUniformSetter("uniform4fv", (a) => Array.from(a[0] || []).slice(0, 4).map((n) => Number(Number(n).toFixed(4))));
  }

  try {
    if (typeof WebGLRenderingContext !== "undefined") patchContextProto(WebGLRenderingContext.prototype, "webgl");
    if (typeof WebGL2RenderingContext !== "undefined") patchContextProto(WebGL2RenderingContext.prototype, "webgl2");
  } catch {}

  // Read-only WebGPU instrumentation: captures WGSL shaders, render/compute pipelines, and canvas configs
  try {
    if (typeof GPUDevice !== "undefined" && GPUDevice.prototype && !GPUDevice.prototype.__siteReaPatched) {
      GPUDevice.prototype.__siteReaPatched = true;
      const origCreateShaderModule = GPUDevice.prototype.createShaderModule;
      if (typeof origCreateShaderModule === "function") {
        GPUDevice.prototype.createShaderModule = function (desc) {
          try {
            const code = typeof desc?.code === "string" ? desc.code.trim() : "";
            if (code && store.webgpu.shaders.length < MAX_WGSL) {
              const dup = store.webgpu.shaders.some((s) => s.code === code);
              if (!dup) {
                store.webgpu.shaders.push({
                  index: store.webgpu.shaders.length,
                  label: desc?.label || null,
                  hasVertex: /@vertex\b/.test(code),
                  hasFragment: /@fragment\b/.test(code),
                  hasCompute: /@compute\b/.test(code),
                  code: code.slice(0, 80000),
                });
              }
            }
          } catch {}
          return origCreateShaderModule.call(this, desc);
        };
      }

      const recordRenderPipeline = (desc) => {
        try {
          if (!desc || store.webgpu.renderPipelines.length >= MAX_PIPELINES) return;
          store.webgpu.renderPipelines.push({
            label: desc.label || null,
            topology: desc.primitive?.topology || "triangle-list",
            cullMode: desc.primitive?.cullMode || "none",
            vertexEntry: desc.vertex?.entryPoint || null,
            fragmentEntry: desc.fragment?.entryPoint || null,
            colorFormats: Array.isArray(desc.fragment?.targets)
              ? desc.fragment.targets.map((t) => t?.format).filter(Boolean)
              : [],
            depthFormat: desc.depthStencil?.format || null,
          });
        } catch {}
      };

      const recordComputePipeline = (desc) => {
        try {
          if (!desc || store.webgpu.computePipelines.length >= MAX_PIPELINES) return;
          store.webgpu.computePipelines.push({
            label: desc.label || null,
            entryPoint: desc.compute?.entryPoint || null,
          });
        } catch {}
      };

      for (const fnName of ["createRenderPipeline", "createRenderPipelineAsync"]) {
        const orig = GPUDevice.prototype[fnName];
        if (typeof orig === "function") {
          GPUDevice.prototype[fnName] = function (desc) {
            recordRenderPipeline(desc);
            return orig.call(this, desc);
          };
        }
      }
      for (const fnName of ["createComputePipeline", "createComputePipelineAsync"]) {
        const orig = GPUDevice.prototype[fnName];
        if (typeof orig === "function") {
          GPUDevice.prototype[fnName] = function (desc) {
            recordComputePipeline(desc);
            return orig.call(this, desc);
          };
        }
      }
    }

    if (typeof GPUCanvasContext !== "undefined" && GPUCanvasContext.prototype && !GPUCanvasContext.prototype.__siteReaPatched) {
      GPUCanvasContext.prototype.__siteReaPatched = true;
      const origConfigure = GPUCanvasContext.prototype.configure;
      if (typeof origConfigure === "function") {
        GPUCanvasContext.prototype.configure = function (cfg) {
          try {
            if (cfg && store.webgpu.canvasConfigs.length < 20) {
              store.webgpu.canvasConfigs.push({
                format: cfg.format || null,
                alphaMode: cfg.alphaMode || null,
                colorSpace: cfg.colorSpace || null,
              });
            }
          } catch {}
          return origConfigure.call(this, cfg);
        };
      }
    }
  } catch {}

  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    let nextAttrs = attrs;
    if (typeof type === "string") {
      const lower = type.toLowerCase();
      if (lower.includes("webgl")) {
        nextAttrs = Object.assign({}, attrs || {}, { preserveDrawingBuffer: true });
      }
      if ((lower.includes("webgl") || lower === "webgpu") && store.contexts.length < 20) {
        store.contexts.push({
          type,
          id: this.id || null,
          className: typeof this.className === "string" ? this.className.slice(0, 120) : null,
        });
      }
    }
    return origGetContext.call(this, type, nextAttrs);
  };
})();`;

export async function extractMotionAndWebglRuntime(page) {
  return await page.evaluate(() => {
    const webglStore = window.__SITE_REA_WEBGL__ || { shaders: [], uniforms: {}, contexts: [] };

    // Detect 3D / motion / scroll libraries
    const engines = [];
    const scriptsText = Array.from(document.scripts || [])
      .map((s) => `${s.src || ""} ${(s.textContent || "").slice(0, 800)}`)
      .join(" ");

    if (window.THREE || /three(\.module)?(\.min)?\.js|__THREE__/i.test(scriptsText)) {
      engines.push({ name: "three.js", version: window.__THREE__ || window.THREE?.REVISION || null });
    }
    if (
      (webglStore.webgpu?.shaders?.length > 0 || webglStore.contexts?.some((c) => c.type === "webgpu")) &&
      (window.THREE || /three\/webgpu|WebGPURenderer|three\/tsl/i.test(scriptsText))
    ) {
      engines.push({ name: "three-webgpu", version: window.__THREE__ || window.THREE?.REVISION || null });
    } else if (webglStore.webgpu?.shaders?.length > 0 || webglStore.contexts?.some((c) => c.type === "webgpu")) {
      engines.push({ name: "webgpu", version: null });
    }
    if (Array.from(document.querySelectorAll("canvas")).some((c) => Boolean(c.__r3f))) {
      engines.push({ name: "react-three-fiber", version: null });
    }
    if (window.gsap || /gsap|ScrollTrigger/i.test(scriptsText)) {
      engines.push({ name: "gsap", version: window.gsap?.version || null });
    }
    if (window.ScrollTrigger || window.gsap?.plugins?.scrollTrigger) {
      engines.push({ name: "gsap-scrolltrigger", version: null });
    }
    if (window.Lenis || document.documentElement.classList.contains("lenis") || /lenis/i.test(scriptsText)) {
      engines.push({ name: "lenis-smooth-scroll", version: null });
    }
    if (window.lottie || window.bodymovin || document.querySelector("lottie-player, dotlottie-player")) {
      engines.push({ name: "lottie", version: null });
    }
    if (document.querySelector("spline-viewer") || /splinetool|prod\.spline\.design/i.test(scriptsText)) {
      engines.push({ name: "spline-3d", version: null });
    }
    if (window.PIXI || /pixi(\.min)?\.js/i.test(scriptsText)) {
      engines.push({ name: "pixi.js", version: window.PIXI?.VERSION || null });
    }
    if (window.BABYLON || /babylon(\.min)?\.js/i.test(scriptsText)) {
      engines.push({ name: "babylon.js", version: null });
    }
    if (document.querySelector("[data-framer-appear-id], [data-projection-id]")) {
      engines.push({ name: "framer-motion", version: null });
    }
    if (document.querySelector("[data-aos]")) {
      engines.push({ name: "aos", version: null });
    }

    // Extract GSAP ScrollTrigger specs if exposed
    const scrollTriggers = [];
    try {
      const ST = window.ScrollTrigger || window.gsap?.core?.globals?.()?.ScrollTrigger;
      if (ST && typeof ST.getAll === "function") {
        for (const st of ST.getAll().slice(0, 60)) {
          const triggerEl = st.trigger;
          scrollTriggers.push({
            id: st.vars?.id || null,
            triggerSelector: triggerEl ? buildSimpleSelector(triggerEl) : null,
            start: st.start,
            end: st.end,
            scrub: st.vars?.scrub ?? false,
            pin: Boolean(st.pin),
            pinSpacing: st.vars?.pinSpacing ?? true,
            snap: Boolean(st.vars?.snap),
          });
        }
      }
    } catch {}

    // Extract Web Animations API (CSS animations + WAAPI)
    const activeAnimations = [];
    try {
      if (typeof document.getAnimations === "function") {
        for (const anim of document.getAnimations().slice(0, 80)) {
          const effect = anim.effect;
          const target = effect?.target;
          const timing = effect?.getComputedTiming ? effect.getComputedTiming() : {};
          let keyframes = [];
          try {
            keyframes = effect?.getKeyframes ? effect.getKeyframes().slice(0, 12) : [];
          } catch {}
          activeAnimations.push({
            animationName: anim.animationName || anim.id || null,
            playState: anim.playState,
            targetSelector: target instanceof Element ? buildSimpleSelector(target) : null,
            duration: timing.duration,
            delay: timing.delay,
            iterations: timing.iterations === Infinity ? "infinite" : timing.iterations,
            easing: timing.easing,
            keyframes,
          });
        }
      }
    } catch {}

    // Inspect all <canvas> elements
    const canvases = Array.from(document.querySelectorAll("canvas")).map((c, idx) => {
      const r = c.getBoundingClientRect();
      const s = getComputedStyle(c);
      return {
        index: idx,
        selector: buildSimpleSelector(c),
        widthAttr: c.width,
        heightAttr: c.height,
        rect: {
          x: Math.round(r.left + window.scrollX),
          y: Math.round(r.top + window.scrollY),
          width: Math.round(r.width),
          height: Math.round(r.height),
        },
        position: s.position,
        zIndex: s.zIndex,
      };
    });

    // Inspect sticky / fixed scroll containers
    const stickyElements = Array.from(document.querySelectorAll("body *"))
      .filter((el) => {
        const s = getComputedStyle(el);
        return s.position === "sticky" || (s.position === "fixed" && el.getBoundingClientRect().height > 120);
      })
      .slice(0, 30)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return {
          selector: buildSimpleSelector(el),
          position: s.position,
          top: s.top,
          height: Math.round(r.height),
          parentHeight: el.parentElement ? Math.round(el.parentElement.getBoundingClientRect().height) : null,
        };
      });

    function buildSimpleSelector(el) {
      if (!el || !el.tagName) return null;
      const tag = el.tagName.toLowerCase();
      if (el.id) return `${tag}#${el.id}`;
      const cls =
        typeof el.className === "string"
          ? el.className
              .trim()
              .split(/\s+/)
              .filter((c) => c && !c.includes(":") && c.length < 40)
              .slice(0, 2)
              .join(".")
          : "";
      return cls ? `${tag}.${cls}` : tag;
    }

    // Extract accessible Three.js / React Three Fiber (R3F) Scene Graph when present
    const roundVec = (v) =>
      v && typeof v.x === "number"
        ? [Number(v.x.toFixed(3)), Number(v.y.toFixed(3)), Number(v.z.toFixed(3))]
        : null;
    const colorHex = (c) => (c && typeof c.getHexString === "function" ? `#${c.getHexString()}` : null);

    let threeScene = null;
    try {
      let r3fState = null;
      for (const c of Array.from(document.querySelectorAll("canvas"))) {
        if (c.__r3f?.store?.getState) {
          r3fState = c.__r3f.store.getState();
          break;
        }
      }
      const sceneObj = r3fState?.scene || (window.scene?.isScene ? window.scene : null);
      const cameraObj = r3fState?.camera || (window.camera?.isCamera ? window.camera : null);
      const glObj = r3fState?.gl || window.renderer || null;

      if (sceneObj || cameraObj) {
        const lights = [];
        const meshes = [];
        if (sceneObj && typeof sceneObj.traverse === "function") {
          sceneObj.traverse((obj) => {
            if (obj.isLight && lights.length < 30) {
              lights.push({
                type: obj.type,
                name: obj.name || null,
                color: colorHex(obj.color),
                intensity: typeof obj.intensity === "number" ? Number(obj.intensity.toFixed(3)) : null,
                position: roundVec(obj.position),
                castShadow: Boolean(obj.castShadow),
              });
            } else if ((obj.isMesh || obj.isPoints || obj.isLine) && meshes.length < 100) {
              const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
              meshes.push({
                type: obj.type,
                name: obj.name || null,
                position: roundVec(obj.position),
                rotation: roundVec(obj.rotation),
                scale: roundVec(obj.scale),
                geometry: obj.geometry
                  ? {
                      type: obj.geometry.type,
                      vertices: obj.geometry.attributes?.position?.count || null,
                    }
                  : null,
                material: mat
                  ? {
                      type: mat.type,
                      color: colorHex(mat.color),
                      emissive: colorHex(mat.emissive),
                      roughness: typeof mat.roughness === "number" ? Number(mat.roughness.toFixed(3)) : undefined,
                      metalness: typeof mat.metalness === "number" ? Number(mat.metalness.toFixed(3)) : undefined,
                      opacity: typeof mat.opacity === "number" ? Number(mat.opacity.toFixed(3)) : undefined,
                      transparent: mat.transparent || undefined,
                      wireframe: mat.wireframe || undefined,
                    }
                  : null,
              });
            }
          });
        }

        threeScene = {
          source: r3fState ? "react-three-fiber" : "global-three",
          renderer: glObj
            ? {
                isWebGPURenderer: Boolean(glObj.isWebGPURenderer),
                toneMapping: glObj.toneMapping ?? null,
                toneMappingExposure: glObj.toneMappingExposure ?? null,
                outputColorSpace: glObj.outputColorSpace ?? null,
                shadowMapEnabled: Boolean(glObj.shadowMap?.enabled),
              }
            : null,
          camera: cameraObj
            ? {
                type: cameraObj.type,
                fov: cameraObj.fov ?? null,
                near: cameraObj.near ?? null,
                far: cameraObj.far ?? null,
                zoom: cameraObj.zoom ?? null,
                position: roundVec(cameraObj.position),
                rotation: roundVec(cameraObj.rotation),
              }
            : null,
          background: colorHex(sceneObj?.background) || (sceneObj?.background?.isTexture ? "Texture" : null),
          hasEnvironmentMap: Boolean(sceneObj?.environment),
          fog: sceneObj?.fog
            ? { type: sceneObj.fog.type || "Fog", color: colorHex(sceneObj.fog.color), near: sceneObj.fog.near, far: sceneObj.fog.far }
            : null,
          lightsCount: lights.length,
          lights,
          meshesCount: meshes.length,
          meshes,
        };
      }
    } catch {}

    return {
      engines,
      webgl: {
        contextCount: webglStore.contexts.length,
        contexts: webglStore.contexts,
        shaderCount: webglStore.shaders.length,
        shaders: webglStore.shaders,
        uniforms: webglStore.uniforms,
      },
      webgpu: {
        supported: Boolean(webglStore.webgpu?.supported),
        canvasConfigs: webglStore.webgpu?.canvasConfigs || [],
        shaderCount: (webglStore.webgpu?.shaders || []).length,
        shaders: webglStore.webgpu?.shaders || [],
        renderPipelines: webglStore.webgpu?.renderPipelines || [],
        computePipelines: webglStore.webgpu?.computePipelines || [],
      },
      threeScene,
      canvases,
      stickyElements,
      scrollTriggers,
      activeAnimations,
    };
  });
}

export function persistWebglAndMotionEvidence(evidenceDir, runtimeData) {
  const webglDir = path.join(evidenceDir, "webgl");
  const shadersDir = path.join(webglDir, "shaders");
  const wgslDir = path.join(webglDir, "wgsl");
  fs.mkdirSync(shadersDir, { recursive: true });
  fs.mkdirSync(wgslDir, { recursive: true });

  const shaderFiles = [];
  for (const sh of runtimeData.webgl?.shaders || []) {
    const ext = sh.type === "vertex" ? ".vert.glsl" : sh.type === "fragment" ? ".frag.glsl" : ".glsl";
    const filename = `shader-${String(sh.index).padStart(3, "0")}${ext}`;
    const relPath = `webgl/shaders/${filename}`;
    const absPath = path.join(evidenceDir, relPath);
    fs.writeFileSync(absPath, sh.source + "\n", "utf8");
    shaderFiles.push({
      index: sh.index,
      context: sh.context,
      type: sh.type,
      localPath: relPath,
      bytes: Buffer.byteLength(sh.source, "utf8"),
    });
  }

  const wgslFiles = [];
  for (const wsh of runtimeData.webgpu?.shaders || []) {
    const filename = `wgsl-${String(wsh.index).padStart(3, "0")}.wgsl`;
    const relPath = `webgl/wgsl/${filename}`;
    const absPath = path.join(evidenceDir, relPath);
    fs.writeFileSync(absPath, wsh.code + "\n", "utf8");
    wgslFiles.push({
      index: wsh.index,
      label: wsh.label || null,
      hasVertex: wsh.hasVertex,
      hasFragment: wsh.hasFragment,
      hasCompute: wsh.hasCompute,
      localPath: relPath,
      bytes: Buffer.byteLength(wsh.code, "utf8"),
    });
  }

  const summaryData = {
    engines: runtimeData.engines || [],
    webgl: {
      contextCount: runtimeData.webgl?.contextCount || 0,
      contexts: runtimeData.webgl?.contexts || [],
      shaderCount: shaderFiles.length,
      shaderFiles,
      uniforms: runtimeData.webgl?.uniforms || {},
    },
    webgpu: {
      supported: Boolean(runtimeData.webgpu?.supported),
      canvasConfigs: runtimeData.webgpu?.canvasConfigs || [],
      shaderCount: wgslFiles.length,
      wgslFiles,
      renderPipelines: runtimeData.webgpu?.renderPipelines || [],
      computePipelines: runtimeData.webgpu?.computePipelines || [],
    },
    threeScene: runtimeData.threeScene || null,
    canvases: runtimeData.canvases || [],
    stickyElements: runtimeData.stickyElements || [],
    scrollTriggers: runtimeData.scrollTriggers || [],
    activeAnimations: runtimeData.activeAnimations || [],
  };

  fs.writeFileSync(path.join(evidenceDir, "rich-media.json"), JSON.stringify(summaryData, null, 2), "utf8");
  return summaryData;
}

/**
 * Samples scroll stops (0% -> 100%) on an already-open page (or launches a browser if only URL is provided),
 * capturing viewport screenshots + per-element transform/opacity/clipPath/sticky tracks + parallax speeds!
 */
export async function sampleScrollTimelineOnPage(
  page,
  evidenceDir,
  { steps = 11, settleMs = 260, deterministic = false } = {}
) {
  const timelineDir = path.join(evidenceDir, "timeline");
  fs.mkdirSync(timelineDir, { recursive: true });

  const clampedSteps = Math.max(3, Math.min(25, steps));

  // Tag candidate trackable elements once so we can follow exact elements across scroll positions
  await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll(
        "section, header, main > *, article, canvas, video, svg, img, h1, h2, [style*='transform'], [style*='opacity'], [data-aos], [data-scroll], [class*='parallax'], [class*='sticky'], [class*='hero']"
      )
    );
    let idCounter = 0;
    for (const el of candidates) {
      if (idCounter >= 120) break;
      const r = el.getBoundingClientRect();
      if (r.width < 20 || r.height < 16) continue;
      if (!el.hasAttribute("data-site-rea-track")) {
        el.setAttribute("data-site-rea-track", `t-${idCounter++}`);
      }
    }
  });

  const docInfo = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
  }));
  const maxScroll = Math.max(0, docInfo.scrollHeight - docInfo.viewportHeight);

  const frames = [];
  const trackHistory = new Map();
  const uniformHistory = new Map();
  const threeCameraTrack = [];
  const threeMeshHistory = new Map();

  for (let i = 0; i < clampedSteps; i++) {
    const progress = clampedSteps === 1 ? 0 : i / (clampedSteps - 1);
    const pct = Math.round(progress * 100);
    const targetY = Math.round(maxScroll * progress);
    const virtualTimeMs = FIRST_LOCK_MS + i * 500;

    await page.evaluate((y) => {
      window.scrollTo({ top: y, behavior: "instant" });
      window.dispatchEvent(new Event("scroll"));
    }, targetY);

    if (deterministic) {
      await lockDeterministicFrame(page, virtualTimeMs);
    } else {
      await page.waitForTimeout(settleMs);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    }

    const shotFile = path.join(timelineDir, `scroll-${String(pct).padStart(3, "0")}.png`);
    await page.screenshot({ path: shotFile, fullPage: false });

    const sample = await page.evaluate(() => {
      const roundVec = (v) =>
        v && typeof v.x === "number"
          ? [Number(v.x.toFixed(4)), Number(v.y.toFixed(4)), Number(v.z.toFixed(4))]
          : null;

      // Sample live WebGL uniforms
      const uniforms = {};
      const storeUniforms = window.__SITE_REA_WEBGL__?.uniforms || {};
      for (const [k, v] of Object.entries(storeUniforms)) {
        if (v !== null && v !== undefined) uniforms[k] = v;
      }

      // Sample live Three.js / R3F camera & mesh transform matrices
      let threeCamera = null;
      const threeMeshes = [];
      try {
        let r3fState = null;
        for (const c of Array.from(document.querySelectorAll("canvas"))) {
          if (c.__r3f?.store?.getState) {
            r3fState = c.__r3f.store.getState();
            break;
          }
        }
        const cam = r3fState?.camera || (window.camera?.isCamera ? window.camera : null);
        const sceneObj = r3fState?.scene || (window.scene?.isScene ? window.scene : null);
        if (cam) {
          threeCamera = {
            position: roundVec(cam.position),
            rotation: roundVec(cam.rotation),
            fov: cam.fov ?? null,
            zoom: cam.zoom ?? null,
            matrixWorld: cam.matrixWorld?.elements
              ? Array.from(cam.matrixWorld.elements).map((n) => Number(n.toFixed(4)))
              : null,
          };
        }
        if (sceneObj && typeof sceneObj.traverse === "function") {
          let mIdx = 0;
          sceneObj.traverse((obj) => {
            if ((obj.isMesh || obj.isGroup || obj.isPoints) && mIdx < 40) {
              const key = obj.name || `${obj.type}_${mIdx}`;
              mIdx++;
              threeMeshes.push({
                key,
                position: roundVec(obj.position),
                rotation: roundVec(obj.rotation),
                scale: roundVec(obj.scale),
                visible: obj.visible !== false,
              });
            }
          });
        }
      } catch {}

      const els = Array.from(document.querySelectorAll("[data-site-rea-track]"));
      return {
        actualScrollY: Math.round(window.scrollY),
        virtualClockMs: window.__SITE_REA_CLOCK__ ? window.__SITE_REA_CLOCK__.now() : null,
        uniforms,
        threeCamera,
        threeMeshes,
        elements: els.map((el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return {
            trackId: el.getAttribute("data-site-rea-track"),
            tag: el.tagName.toLowerCase(),
            id: el.id || null,
            className: typeof el.className === "string" ? el.className.trim().slice(0, 80) : null,
            textPreview: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 50),
            vpTop: Math.round(r.top),
            vpLeft: Math.round(r.left),
            docTop: Math.round(r.top + window.scrollY),
            width: Math.round(r.width),
            height: Math.round(r.height),
            position: s.position,
            opacity: Number(parseFloat(s.opacity).toFixed(3)),
            transform: s.transform === "none" ? "none" : s.transform,
            clipPath: s.clipPath === "none" ? "none" : s.clipPath,
            filter: s.filter === "none" ? "none" : s.filter,
          };
        }),
      };
    });

    frames.push({
      stepIndex: i,
      pct,
      targetScrollY: targetY,
      actualScrollY: sample.actualScrollY,
      virtualTimeMs: deterministic ? virtualTimeMs : sample.virtualClockMs,
      screenshot: shotFile,
    });

    // Record WebGL uniform trajectories across scroll stops
    for (const [uName, uVal] of Object.entries(sample.uniforms || {})) {
      if (!uniformHistory.has(uName)) uniformHistory.set(uName, []);
      uniformHistory.get(uName).push({ pct, scrollY: sample.actualScrollY, value: uVal });
    }

    // Record Three.js camera & mesh matrix trajectories across scroll stops
    if (sample.threeCamera) {
      threeCameraTrack.push({ pct, scrollY: sample.actualScrollY, ...sample.threeCamera });
    }
    for (const m of sample.threeMeshes || []) {
      if (!threeMeshHistory.has(m.key)) threeMeshHistory.set(m.key, []);
      threeMeshHistory.get(m.key).push({
        pct,
        position: m.position,
        rotation: m.rotation,
        scale: m.scale,
        visible: m.visible,
      });
    }

    for (const el of sample.elements) {
      if (!trackHistory.has(el.trackId)) {
        trackHistory.set(el.trackId, {
          trackId: el.trackId,
          tag: el.tag,
          id: el.id,
          className: el.className,
          textPreview: el.textPreview,
          samples: [],
        });
      }
      trackHistory.get(el.trackId).samples.push({
        pct,
        scrollY: sample.actualScrollY,
        vpTop: el.vpTop,
        docTop: el.docTop,
        width: el.width,
        height: el.height,
        position: el.position,
        opacity: el.opacity,
        transform: el.transform,
        clipPath: el.clipPath,
        filter: el.filter,
      });
    }
  }

  // Scroll back to top cleanly
  await page.evaluate(() => window.scrollTo(0, 0));

  // Filter uniform tracks & Three.js mesh tracks to only those that change or carry keyframe data
  const uniformTracks = {};
  for (const [uName, samples] of uniformHistory.entries()) {
    uniformTracks[uName] = samples;
  }
  const threeMeshTracks = {};
  for (const [key, samples] of threeMeshHistory.entries()) {
    const serialized = new Set(samples.map((s) => JSON.stringify([s.position, s.rotation, s.scale, s.visible])));
    if (serialized.size > 1 || samples.length > 0) {
      threeMeshTracks[key] = { animated: serialized.size > 1, keyframes: samples };
    }
  }

  // Analyze which elements actually animate, pin/stick, or parallax with scroll!
  const animatedTracks = [];
  for (const track of trackHistory.values()) {
    const s = track.samples;
    if (s.length < 2) continue;

    const transforms = new Set(s.map((x) => x.transform));
    const opacities = new Set(s.map((x) => x.opacity));
    const clipPaths = new Set(s.map((x) => x.clipPath));
    const filters = new Set(s.map((x) => x.filter));
    const docTops = s.map((x) => x.docTop);
    const docTopDrift = Math.max(...docTops) - Math.min(...docTops);
    const isStickyOrFixed = s.some((x) => x.position === "sticky" || x.position === "fixed");

    const changes = [];
    if (transforms.size > 1) changes.push("transform");
    if (opacities.size > 1) changes.push("opacity");
    if (clipPaths.size > 1) changes.push("clip-path");
    if (filters.size > 1) changes.push("filter");
    if (isStickyOrFixed && docTopDrift > 40) changes.push("sticky-pin");
    else if (docTopDrift > 20 && transforms.size === 1) changes.push("parallax-offset");

    if (changes.length > 0) {
      // Compute parallax speed ratio where transform/docTop changes across scroll
      const first = s[0];
      const last = s[s.length - 1];
      const scrollSpan = Math.max(1, last.scrollY - first.scrollY);
      const parallaxSpeed = Number(((last.docTop - first.docTop) / scrollSpan).toFixed(3));

      animatedTracks.push({
        trackId: track.trackId,
        tag: track.tag,
        id: track.id,
        className: track.className,
        textPreview: track.textPreview,
        changes,
        parallaxSpeed,
        keyframes: s.map((x) => ({
          pct: x.pct,
          scrollY: x.scrollY,
          vpTop: x.vpTop,
          opacity: x.opacity,
          transform: x.transform,
          ...(x.clipPath !== "none" ? { clipPath: x.clipPath } : {}),
          ...(x.filter !== "none" ? { filter: x.filter } : {}),
        })),
      });
    }
  }

  const timelineReport = {
    capturedAt: new Date().toISOString(),
    deterministic,
    documentSize: docInfo,
    maxScroll,
    steps: clampedSteps,
    frames,
    animatedTracksCount: animatedTracks.length,
    animatedTracks: animatedTracks.slice(0, 60),
    uniformTracks,
    threeCameraTrack,
    threeMeshTracks,
  };

  fs.writeFileSync(path.join(evidenceDir, "scroll-timeline.json"), JSON.stringify(timelineReport, null, 2), "utf8");
  return timelineReport;
}

export async function captureScrollTimeline({
  url,
  evidenceDir,
  steps = 11,
  settleMs = 260,
  viewport = "desktop",
  deterministic = true,
  timeoutMs = 45000,
}) {
  if (!url) throw new Error("url is required");
  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = `https://${normalizedUrl}`;
  const resolvedEvidence = path.resolve(evidenceDir);
  fs.mkdirSync(resolvedEvidence, { recursive: true });

  const vp = viewport === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  const { browser } = await launchBrowser();

  try {
    const context = await browser.newContext({
      viewport: vp,
      deviceScaleFactor: 1,
      isMobile: viewport === "mobile",
    });
    const page = await context.newPage();
    if (deterministic) {
      await page.addInitScript(buildDeterministicClockInitScript(getEvidenceClock(resolvedEvidence, { create: true })));
    }
    await page.addInitScript(WEBGL_MOTION_INIT_SCRIPT);

    let response;
    try {
      response = await page.goto(normalizedUrl, { waitUntil: "networkidle", timeout: timeoutMs });
    } catch {
      response = await page.goto(normalizedUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    }

    const blockCheck = await detectBlockedPage(page, response);
    if (blockCheck.blocked) {
      return { status: "blocked", ...blockCheck };
    }

    await scrollAndSettlePage(page, { waitMs: 600 });
    const runtimeData = await extractMotionAndWebglRuntime(page);
    const richMedia = persistWebglAndMotionEvidence(resolvedEvidence, runtimeData);
    const timeline = await sampleScrollTimelineOnPage(page, resolvedEvidence, {
      steps,
      settleMs,
      deterministic,
    });

    return {
      status: "ok",
      url: normalizedUrl,
      evidenceDir: resolvedEvidence,
      deterministic,
      engines: richMedia.engines,
      shaderCount: richMedia.webgl.shaderCount,
      webgpuShaderCount: richMedia.webgpu?.shaderCount || 0,
      canvasCount: richMedia.canvases.length,
      scrollTriggerCount: richMedia.scrollTriggers.length,
      activeAnimationsCount: richMedia.activeAnimations.length,
      steps: timeline.steps,
      maxScroll: timeline.maxScroll,
      animatedTracksCount: timeline.animatedTracksCount,
      uniformTrackCount: Object.keys(timeline.uniformTracks || {}).length,
      threeCameraKeyframes: (timeline.threeCameraTrack || []).length,
      threeMeshTrackCount: Object.keys(timeline.threeMeshTracks || {}).length,
      frames: timeline.frames,
      animatedTracksPreview: timeline.animatedTracks.slice(0, 15).map((t) => ({
        trackId: t.trackId,
        tag: t.tag,
        id: t.id,
        className: t.className,
        changes: t.changes,
        parallaxSpeed: t.parallaxSpeed,
      })),
    };
  } finally {
    await browser.close();
  }
}
