import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { captureSite } from "./capture.mjs";
import { probeInteraction } from "./probe.mjs";
import { scaffoldProject } from "./scaffold.mjs";
import { verifyClone } from "./verify.mjs";
import { resolveChromeExecutable } from "./browser.mjs";
import { captureScrollTimeline } from "./webgl-motion.mjs";
import { captureScrollScrub } from "./scroll-scrub.mjs";
import { scaffoldMockBackend } from "./api-mock.mjs";
import { ingestLocalArchive } from "./ingest-local.mjs";

function jsonResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(err) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            status: "error",
            message: String(err?.message || err),
          },
          null,
          2
        ),
      },
    ],
  };
}

function readJsonFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found at ${filePath}. Run capture_site or ingest_local_archive first.`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export async function startMcpServer() {
  const server = new McpServer({
    name: "site-rea",
    version: "1.0.0",
  });

  server.tool(
    "capture_site",
    "Capture a live website into an evidence directory: desktop & mobile screenshots, per-section slices, design tokens, semantic DOM blueprints, localized assets (images, SVGs, fonts, 3D models, Lottie, videos), WebGPU WGSL & WebGL GLSL shaders, Three.js scene graphs, redacted JSON API contracts, a static mirror, and runtime-cache: a recording of every network response (both viewports, including lazy chunks requested while scrolling and hovering) that is then rehearsed with the internet cut off and completed until nothing is missing. The result reports any request that could not be recorded.",
    {
      url: z.string().describe("Target website URL (e.g. https://example.com)"),
      output_dir: z
        .string()
        .optional()
        .describe("Optional directory path for the .site-rea evidence bundle"),
      download_assets: z
        .boolean()
        .optional()
        .default(true)
        .describe("Download images, fonts, icons, 3D models, Lottie JSONs, and videos locally (default: true)"),
      capture_mirror: z
        .boolean()
        .optional()
        .default(true)
        .describe("Build a 1:1 frozen offline static mirror in mirror/index.html (default: true)"),
      capture_runtime: z
        .boolean()
        .optional()
        .default(true)
        .describe("Record every network response into runtime-cache for runtime-mirror replay (default: true)"),
      rehearse: z
        .boolean()
        .optional()
        .default(true)
        .describe("After recording, run the mirror offline and fetch whatever it still asks for until nothing is missing (default: true; adds time)"),
      capture_mobile: z
        .boolean()
        .optional()
        .default(true)
        .describe("Also capture mobile 390x844 viewport screenshots and layout metrics (default: true)"),
      capture_timeline: z
        .enum(["auto", "always", "never"])
        .optional()
        .default("auto")
        .describe("Scroll keyframe timeline sampling: 'auto' samples automatically when WebGL/WebGPU/Canvas/Three/sticky/GSAP/parallax is detected (default: auto)"),
      timeline_steps: z
        .number()
        .int()
        .min(3)
        .max(25)
        .optional()
        .default(9)
        .describe("Number of scroll stops from 0% to 100% when sampling timeline (default: 9)"),
      deterministic: z
        .boolean()
        .optional()
        .default(false)
        .describe("Deterministic mode, recommended whenever verify_clone will be used on a page that moves: virtual clock for performance.now / Date / requestAnimationFrame, per-call-site seeded Math.random, timers of 2.4 s or longer held (autoplay carousels stay on their first slide), CSS animations and videos put in a fixed state at each screenshot"),
      wait_ms: z
        .number()
        .int()
        .min(0)
        .max(15000)
        .optional()
        .default(1200)
        .describe("Extra settle delay in ms after scrolling and font loading (default: 1200)"),
      max_sections: z
        .number()
        .int()
        .min(1)
        .max(60)
        .optional()
        .default(25)
        .describe("Maximum number of top-level visual sections to slice (default: 25)"),
    },
    async (args) => {
      try {
        const timelineMode =
          args.capture_timeline === "always" ? true : args.capture_timeline === "never" ? false : "auto";
        const result = await captureSite({
          url: args.url,
          outputDir: args.output_dir,
          downloadAssets: args.download_assets,
          captureMirror: args.capture_mirror,
          captureRuntime: args.capture_runtime,
          rehearse: args.rehearse,
          captureMobile: args.capture_mobile,
          captureTimeline: timelineMode,
          timelineSteps: args.timeline_steps,
          deterministic: args.deterministic,
          waitMs: args.wait_ms,
          maxSections: args.max_sections,
        });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "capture_scroll_timeline",
    "Sample a live page across scroll positions 0%..100% with deterministic virtual clock locking: captures viewport screenshots at every stop, DOM parallax/sticky/transform curves, WebGL uniform trajectories (uniformTracks), Three.js/R3F camera & mesh matrix trajectories (threeCameraTrack / threeMeshTracks), WebGPU WGSL + WebGL GLSL shaders, GSAP ScrollTrigger specs, and WAAPI animations.",
    {
      url: z.string().describe("Target website URL"),
      evidence_dir: z.string().describe("Path to the .site-rea evidence directory"),
      steps: z
        .number()
        .int()
        .min(3)
        .max(25)
        .optional()
        .default(11)
        .describe("Number of scroll stops from 0% to 100% (default: 11)"),
      viewport: z.enum(["desktop", "mobile"]).optional().default("desktop"),
      deterministic: z
        .boolean()
        .optional()
        .default(true)
        .describe("Lock virtual clock (performance.now / rAF / Math.random) for frame-exact sampling (default: true)"),
    },
    async (args) => {
      try {
        const res = await captureScrollTimeline({
          url: args.url,
          evidenceDir: args.evidence_dir,
          steps: args.steps,
          viewport: args.viewport,
          deterministic: args.deterministic,
        });
        return jsonResult(res);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "capture_scroll_scrub",
    "Scroll-scrub: records 12..180 frames of the page (or of one element) across scroll 0%..100% under the deterministic clock and writes a <canvas> player that shows the matching frame as the visitor scrolls. The result is a film of the original: it looks like it at the recorded positions and viewport size, but nothing in it is interactive and text is not selectable. Use scaffold_project mode 'scroll-scrub' afterwards.",
    {
      url: z.string().describe("Target website URL"),
      evidence_dir: z.string().describe("Path to the .site-rea evidence directory"),
      frame_count: z
        .number()
        .int()
        .min(8)
        .max(180)
        .optional()
        .default(60)
        .describe("Number of scroll frames to record across 0%..100% (default: 60)"),
      selector: z
        .string()
        .optional()
        .describe("Optional CSS selector of the 3D <canvas> or stage container to capture instead of full viewport"),
      format: z.enum(["jpeg", "png"]).optional().default("jpeg"),
      quality: z.number().int().min(50).max(100).optional().default(90),
      viewport: z.enum(["desktop", "mobile"]).optional().default("desktop"),
      deterministic: z.boolean().optional().default(true),
    },
    async (args) => {
      try {
        const res = await captureScrollScrub({
          url: args.url,
          evidenceDir: args.evidence_dir,
          frameCount: args.frame_count,
          selector: args.selector || null,
          format: args.format,
          quality: args.quality,
          viewport: args.viewport,
          deterministic: args.deterministic,
        });
        return jsonResult(res);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "inspect_rich_media",
    "Inspect captured 3D/WebGL/WebGPU/Three.js/Motion evidence from a Site-REA bundle: detected engines, extracted GLSL & WebGPU WGSL shader files, WebGPU render/compute pipelines, Three.js/R3F scene graph (camera/lights/meshes/materials), per-scroll-stop Three.js camera/mesh/uniform trajectories, 3D model (.glb/.gltf/.hdr/.splat/.splinecode) & Lottie asset paths, sticky containers, and WAAPI animations.",
    {
      evidence_dir: z.string().describe("Path to the .site-rea evidence directory"),
      include_timeline_tracks: z
        .boolean()
        .optional()
        .default(true)
        .describe("Include animated scroll-timeline keyframe tracks, uniformTracks, and threeCameraTrack/threeMeshTracks if scroll-timeline.json exists (default: true)"),
    },
    async ({ evidence_dir, include_timeline_tracks }) => {
      try {
        const base = path.resolve(evidence_dir);
        const richMedia = fs.existsSync(path.join(base, "rich-media.json"))
          ? JSON.parse(fs.readFileSync(path.join(base, "rich-media.json"), "utf8"))
          : null;
        const assets = fs.existsSync(path.join(base, "assets-manifest.json"))
          ? JSON.parse(fs.readFileSync(path.join(base, "assets-manifest.json"), "utf8"))
          : [];
        const timeline =
          include_timeline_tracks && fs.existsSync(path.join(base, "scroll-timeline.json"))
            ? JSON.parse(fs.readFileSync(path.join(base, "scroll-timeline.json"), "utf8"))
            : null;

        const mediaAssets = assets.filter((a) => ["model", "shader", "lottie", "video", "wasm"].includes(a.type) && a.downloaded);
        return jsonResult({
          status: "ok",
          richMedia,
          mediaAssets,
          scrollTimeline: timeline
            ? {
                steps: timeline.steps,
                deterministic: Boolean(timeline.deterministic),
                maxScroll: timeline.maxScroll,
                frames: timeline.frames,
                animatedTracksCount: timeline.animatedTracksCount,
                animatedTracks: timeline.animatedTracks,
                uniformTracks: timeline.uniformTracks || {},
                threeCameraTrack: timeline.threeCameraTrack || [],
                threeMeshTracks: timeline.threeMeshTracks || {},
              }
            : null,
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_design_tokens",
    "Read the complete extracted design system from a Site-REA evidence bundle: colors by role, gradients, typography hierarchy, Google Font links, @font-face rules, :root CSS custom properties, shadows, border-radii, container widths, and @keyframes.",
    {
      evidence_dir: z.string().describe("Path to the .site-rea evidence directory"),
    },
    async ({ evidence_dir }) => {
      try {
        const tokens = readJsonFile(path.join(path.resolve(evidence_dir), "design-tokens.json"), "design-tokens.json");
        return jsonResult(tokens);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_section_blueprint",
    "Inspect the semantic DOM blueprint, exact copy, local asset paths, inline SVG references, computed layout styles, and screenshot path of one or all captured visual sections.",
    {
      evidence_dir: z.string().describe("Path to the .site-rea evidence directory"),
      section_index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Section index (0-based). Omit to return the compact table of contents of all sections + interactive hints."),
    },
    async ({ evidence_dir, section_index }) => {
      try {
        const bp = readJsonFile(path.join(path.resolve(evidence_dir), "blueprint.json"), "blueprint.json");
        if (section_index === undefined) {
          return jsonResult({
            url: bp.url,
            documentSize: bp.documentSize,
            interactiveHints: bp.interactiveHints,
            sections: bp.sections.map((s) => ({
              index: s.index,
              role: s.role,
              tag: s.tag,
              id: s.id,
              heading: s.heading,
              textPreview: s.textPreview,
              boundingBox: s.boundingBox,
              screenshot: s.screenshot,
            })),
          });
        }
        const section = bp.sections.find((s) => s.index === section_index);
        if (!section) {
          throw new Error(`Section index ${section_index} out of range (0..${bp.sections.length - 1}).`);
        }
        return jsonResult(section);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "list_assets",
    "List all downloaded local images, extracted inline SVGs, fonts, 3D models (.glb/.gltf/.hdr/.splat/.splinecode), shaders, Lottie animations, videos, and WASM files in a Site-REA evidence bundle.",
    {
      evidence_dir: z.string().describe("Path to the .site-rea evidence directory"),
      type: z
        .enum(["all", "image", "svg", "font", "video", "model", "shader", "lottie", "wasm"])
        .optional()
        .default("all")
        .describe("Filter asset type (default: all)"),
      only_downloaded: z
        .boolean()
        .optional()
        .default(true)
        .describe("Only include locally saved assets and inline SVGs (default: true)"),
    },
    async ({ evidence_dir, type, only_downloaded }) => {
      try {
        const manifest = readJsonFile(
          path.join(path.resolve(evidence_dir), "assets-manifest.json"),
          "assets-manifest.json"
        );
        let filtered = manifest;
        if (type && type !== "all") {
          filtered = filtered.filter((a) => a.type === type);
        }
        if (only_downloaded) {
          filtered = filtered.filter((a) => a.downloaded === true || a.source === "inline");
        }
        return jsonResult({
          total: filtered.length,
          assets: filtered,
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "discover_routes",
    "Return all same-origin internal pages/routes discovered on the captured site, grouped by zone (nav, footer, body) for optional multi-page cloning.",
    {
      evidence_dir: z.string().describe("Path to the .site-rea evidence directory"),
    },
    async ({ evidence_dir }) => {
      try {
        const routes = readJsonFile(path.join(path.resolve(evidence_dir), "routes.json"), "routes.json");
        return jsonResult({
          total: routes.length,
          navRoutes: routes.filter((r) => r.zones?.includes("nav")),
          footerRoutes: routes.filter((r) => r.zones?.includes("footer") && !r.zones?.includes("nav")),
          otherRoutes: routes.filter((r) => !r.zones?.includes("nav") && !r.zones?.includes("footer")),
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "probe_interaction",
    "Probe a live interactive element (click, hover, fill, or scroll) on the target URL to observe dropdowns, tabs, accordions, pricing toggles, modals, or hover style deltas, saving before/after screenshots.",
    {
      url: z.string().describe("Live target website URL"),
      evidence_dir: z.string().describe("Path to the .site-rea evidence directory where probe screenshots are saved"),
      action: z.enum(["click", "hover", "fill", "scroll"]).describe("Interaction to execute"),
      selector: z
        .string()
        .optional()
        .describe("CSS selector or Playwright text locator (e.g. 'button.pricing-toggle' or 'text=Annual')"),
      value: z.string().optional().describe("Input value for fill or scroll Y offset in pixels"),
      viewport: z.enum(["desktop", "mobile"]).optional().default("desktop"),
    },
    async (args) => {
      try {
        const res = await probeInteraction({
          url: args.url,
          evidenceDir: args.evidence_dir,
          action: args.action,
          selector: args.selector,
          value: args.value,
          viewport: args.viewport,
        });
        return jsonResult(res);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "scaffold_project",
    "Create a project from an evidence directory. 'runtime-mirror': the recording plus a zero-dependency server (node server.mjs) that replays the original front-end offline, scripts included. 'static-mirror': the rendered page frozen as one HTML + CSS, no scripts. 'vanilla': the same markup with every block labelled, plus the site CSS. 'react-vite-tailwind': one React component per page block (HTML converted to JSX), the site CSS, Tailwind utilities available. 'scroll-scrub': a canvas that plays pre-rendered frames as you scroll. vanilla / react / static keep the captured markup and styling but not behaviour (menus, sliders, forms): the page scripts are not part of them. Always run verify_clone afterwards.",
    {
      evidence_dir: z.string().describe("Path to the .site-rea evidence directory"),
      target_dir: z.string().describe("Absolute path where the cloned website project should be created"),
      mode: z
        .enum(["vanilla", "react-vite-tailwind", "static-mirror", "runtime-mirror", "scroll-scrub"])
        .optional()
        .default("vanilla")
        .describe("Output project architecture (default: vanilla)"),
      copy_assets: z.boolean().optional().default(true).describe("Copy localized assets into the target project (default: true)"),
    },
    async (args) => {
      try {
        const res = scaffoldProject({
          evidenceDir: args.evidence_dir,
          targetDir: args.target_dir,
          mode: args.mode,
          copyAssets: args.copy_assets,
        });
        return jsonResult(res);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "scaffold_mock_backend",
    "Generate a zero-dependency local stateful Node.js Mock API Backend (with JSON CRUD persistence, local demo-auth sandbox endpoints, and a client fetch bridge) from the sanitized api-contracts.json recorded during capture or HAR ingestion.",
    {
      evidence_dir: z.string().describe("Path to the .site-rea evidence directory containing api-contracts.json"),
      target_dir: z.string().describe("Target cloned project directory where mock-backend/ will be created"),
      port: z.number().int().min(1024).max(65535).optional().default(4174).describe("Local mock server port (default: 4174)"),
    },
    async (args) => {
      try {
        const res = scaffoldMockBackend({
          evidenceDir: args.evidence_dir,
          targetDir: args.target_dir,
          port: args.port,
        });
        return jsonResult(res);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "ingest_local_archive",
    "Completely offline ingestion of a user-saved local HTML / SingleFile HTML / webpage folder and/or Chrome DevTools .har archive into a full Site-REA Evidence Bundle (screenshots, design tokens, blueprints, localized assets, WebGL shaders, and redacted API contracts). Never contacts external sites or bypasses any verification.",
    {
      html_path: z
        .string()
        .optional()
        .describe("Absolute path to a local saved .html / SingleFile .html or directory containing index.html"),
      har_path: z
        .string()
        .optional()
        .describe("Absolute path to a local Chrome DevTools .har archive"),
      output_dir: z
        .string()
        .optional()
        .describe("Optional output directory for the .site-rea evidence bundle"),
      capture_mobile: z.boolean().optional().default(true),
    },
    async (args) => {
      try {
        const res = await ingestLocalArchive({
          htmlPath: args.html_path,
          harPath: args.har_path,
          outputDir: args.output_dir,
          captureMobile: args.capture_mobile,
        });
        return jsonResult(res);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "verify_clone",
    "Compare a clone with the screenshots of the original: pixel similarity for hero, full page, per-section bands and scroll stops, 3-panel (Original | Diff | Clone) images, console errors, broken images, overflow. Anything served from a local directory is checked with the internet cut off, and every attempt to reach it is reported. A runtime-mirror is checked two ways: 'exact' (recording answers at the network layer under the real URL, what `site-rea open` shows) and 'portable' (the project's own server.mjs on 127.0.0.1); results are in replayModes. Report the numbers as measured.",
    {
      evidence_dir: z.string().describe("Path to the .site-rea evidence directory"),
      clone_dir: z
        .string()
        .optional()
        .describe("Local directory of the cloned website (automatically serves vanilla/static/scroll-scrub OR boots runtime-mirror/server.mjs)"),
      clone_url: z
        .string()
        .optional()
        .describe("Running local URL of the cloned website (e.g. http://127.0.0.1:5173) if using a dev server"),
      viewports: z
        .array(z.enum(["desktop", "mobile"]))
        .optional()
        .default(["desktop", "mobile"])
        .describe("Viewports to verify (default: desktop and mobile)"),
      verify_scroll_timeline: z
        .enum(["auto", "always", "never"])
        .optional()
        .default("auto")
        .describe("Compare scroll-stop frames against captured scroll-timeline.json (default: auto)"),
      deterministic: z
        .enum(["auto", "always", "never"])
        .optional()
        .default("auto")
        .describe("Lock virtual clock during verification ('auto' matches capture_site's deterministic setting)"),
      replay: z
        .enum(["auto", "exact", "portable", "both"])
        .optional()
        .default("auto")
        .describe("For runtime-mirror projects: which replay to verify ('auto' = both)"),
    },
    async (args) => {
      try {
        const timelineFlag =
          args.verify_scroll_timeline === "always"
            ? true
            : args.verify_scroll_timeline === "never"
            ? false
            : "auto";
        const detFlag =
          args.deterministic === "always" ? true : args.deterministic === "never" ? false : "auto";
        const res = await verifyClone({
          evidenceDir: args.evidence_dir,
          cloneDir: args.clone_dir,
          cloneUrl: args.clone_url,
          viewports: args.viewports,
          verifyScrollTimeline: timelineFlag,
          deterministic: detFlag,
          replay: args.replay,
        });
        return jsonResult(res);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "check_environment",
    "Check Site-REA runtime readiness: Node.js version, detected Chromium/Chrome executable path, and GPU/WebGPU flags.",
    {},
    async () => {
      const chromePath = resolveChromeExecutable();
      return jsonResult({
        status: chromePath ? "ready" : "missing_browser",
        version: "1.0.0",
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        chromeExecutable: chromePath,
        webgpuFlagEnabled: true,
      });
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
