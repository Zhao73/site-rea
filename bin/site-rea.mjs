#!/usr/bin/env node
import { startMcpServer } from "../src/mcp-server.mjs";
import { captureSite } from "../src/capture.mjs";
import { scaffoldProject } from "../src/scaffold.mjs";
import { verifyClone } from "../src/verify.mjs";
import { startStaticServer } from "../src/static-server.mjs";
import { runDoctor, getSetupInstructions, installAntigravityPlugin } from "../src/setup.mjs";
import { captureScrollTimeline } from "../src/webgl-motion.mjs";
import { captureScrollScrub } from "../src/scroll-scrub.mjs";
import { scaffoldMockBackend } from "../src/api-mock.mjs";
import { ingestLocalArchive } from "../src/ingest-local.mjs";
import { openMirror } from "../src/open-mirror.mjs";

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function printHelp() {
  console.log(`site-rea v1.0.0 — Website Reverse-Engineering & Cloning Engine (MCP + CLI + Antigravity Plugin)

Usage:
  site-rea install                                  Install Antigravity plugin (~/.gemini/config/plugins/site-rea)
  site-rea mcp                                      Start MCP server over stdio (14 tools)
  site-rea capture <url> [--out <dir>] [--timeline] [--deterministic] [--no-runtime] [--no-rehearse]
  site-rea timeline <url> <evidence-dir> [--steps 11] [--deterministic]
  site-rea scrub <url> <evidence-dir> [--frames 60] [--selector <css>] [--format jpeg|png]
  site-rea ingest [--html <path>] [--har <path>] [--out <dir>]
  site-rea scaffold <evidence-dir> <target-dir> [--mode vanilla|react-vite-tailwind|static-mirror|runtime-mirror|scroll-scrub]
  site-rea mock-backend <evidence-dir> <target-dir> [--port 4174]
  site-rea verify <evidence-dir> [--dir <clone-dir> | --url <url>] [--deterministic] [--replay exact|portable|both]
  site-rea open <mirror-dir|evidence-dir>           Open a recording in a browser window under its real address, offline
  site-rea serve <dir> [--port 4173]                Serve a local site directory for preview
  site-rea doctor                                   Check Chromium, Node, and plugin installation
  site-rea setup                                    Print MCP config snippets for Claude Code / Codex / Cursor / Antigravity
`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    printHelp();
    process.exit(0);
  }

  const { flags, positional } = parseFlags(rest);

  if (cmd === "install") {
    console.log(JSON.stringify(installAntigravityPlugin(), null, 2));
    return;
  }

  if (cmd === "mcp") {
    await startMcpServer();
    return;
  }

  if (cmd === "doctor") {
    console.log(JSON.stringify(runDoctor(), null, 2));
    return;
  }

  if (cmd === "setup") {
    console.log(JSON.stringify(getSetupInstructions(), null, 2));
    return;
  }

  if (cmd === "capture") {
    const url = positional[0];
    if (!url) {
      console.error("Error: missing <url>");
      process.exit(1);
    }
    const res = await captureSite({
      url,
      outputDir: flags.out,
      downloadAssets: !flags["no-assets"],
      captureMirror: !flags["no-mirror"],
      captureRuntime: !flags["no-runtime"],
      rehearse: !flags["no-rehearse"],
      captureMobile: !flags["no-mobile"],
      captureTimeline: flags.timeline ? true : flags["no-timeline"] ? false : "auto",
      timelineSteps: flags.steps ? Number(flags.steps) : 9,
      deterministic: Boolean(flags.deterministic),
      waitMs: flags.wait ? Number(flags.wait) : 1200,
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "timeline") {
    const [url, evidenceDir] = positional;
    if (!url || !evidenceDir) {
      console.error("Error: usage: site-rea timeline <url> <evidence-dir> [--steps 11]");
      process.exit(1);
    }
    const res = await captureScrollTimeline({
      url,
      evidenceDir,
      steps: flags.steps ? Number(flags.steps) : 11,
      viewport: flags.mobile ? "mobile" : "desktop",
      deterministic: !flags["no-deterministic"],
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "scrub") {
    const [url, evidenceDir] = positional;
    if (!url || !evidenceDir) {
      console.error("Error: usage: site-rea scrub <url> <evidence-dir> [--frames 60] [--selector <css>]");
      process.exit(1);
    }
    const res = await captureScrollScrub({
      url,
      evidenceDir,
      frameCount: flags.frames ? Number(flags.frames) : 60,
      selector: flags.selector || null,
      format: flags.format === "png" ? "png" : "jpeg",
      viewport: flags.mobile ? "mobile" : "desktop",
      deterministic: !flags["no-deterministic"],
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "ingest") {
    const res = await ingestLocalArchive({
      htmlPath: flags.html,
      harPath: flags.har,
      outputDir: flags.out,
      captureMobile: !flags["no-mobile"],
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "scaffold") {
    const [evidenceDir, targetDir] = positional;
    if (!evidenceDir || !targetDir) {
      console.error(
        "Error: usage: site-rea scaffold <evidence-dir> <target-dir> [--mode vanilla|react-vite-tailwind|static-mirror|runtime-mirror|scroll-scrub]"
      );
      process.exit(1);
    }
    const res = scaffoldProject({
      evidenceDir,
      targetDir,
      mode: flags.mode || "vanilla",
      copyAssets: !flags["no-assets"],
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "mock-backend") {
    const [evidenceDir, targetDir] = positional;
    if (!evidenceDir || !targetDir) {
      console.error("Error: usage: site-rea mock-backend <evidence-dir> <target-dir> [--port 4174]");
      process.exit(1);
    }
    const res = scaffoldMockBackend({
      evidenceDir,
      targetDir,
      port: flags.port ? Number(flags.port) : 4174,
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "verify") {
    const evidenceDir = positional[0];
    if (!evidenceDir) {
      console.error("Error: usage: site-rea verify <evidence-dir> [--dir <clone-dir> | --url <url>]");
      process.exit(1);
    }
    const res = await verifyClone({
      evidenceDir,
      cloneDir: flags.dir,
      cloneUrl: flags.url,
      verifyScrollTimeline: flags["no-timeline"] ? false : "auto",
      deterministic: flags.deterministic ? true : flags["no-deterministic"] ? false : "auto",
      replay: ["exact", "portable", "both"].includes(flags.replay) ? flags.replay : "auto",
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "open") {
    const dir = positional[0];
    if (!dir) {
      console.error("Error: usage: site-rea open <mirror-dir|evidence-dir>");
      process.exit(1);
    }
    const session = await openMirror({ dir });
    console.log(`Replaying ${session.pageUrl} from the recording (no internet access). Close the browser window to stop.`);
    await session.closed;
    const r = session.report;
    console.log(JSON.stringify({ responsesServed: r.served, notRecorded: r.misses.slice(0, 20) }, null, 2));
    return;
  }

  if (cmd === "serve") {
    const dir = positional[0] || ".";
    const port = flags.port ? Number(flags.port) : 4173;
    const srv = await startStaticServer(dir, { port });
    console.log(`Site-REA preview server running at ${srv.url} (serving ${dir})`);
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
