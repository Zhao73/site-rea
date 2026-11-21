import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { resolveChromeExecutable } from "./browser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");
const BIN_PATH = path.join(PKG_ROOT, "bin", "site-rea.mjs");
const PLUGIN_TEMPLATE_DIR = path.join(PKG_ROOT, "plugin");

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function preferredNodeExecutable() {
  if (fs.existsSync("/opt/homebrew/bin/node")) return "/opt/homebrew/bin/node";
  return process.execPath;
}

export function runDoctor() {
  const chromePath = resolveChromeExecutable();
  const pluginDir = path.join(os.homedir(), ".gemini", "config", "plugins", "site-rea");
  const pluginInstalled = fs.existsSync(path.join(pluginDir, "plugin.json"));

  return {
    status: chromePath ? "ok" : "needs_browser",
    nodeVersion: process.version,
    nodeExecutable: preferredNodeExecutable(),
    siteReaBin: BIN_PATH,
    chromeExecutable: chromePath || null,
    antigravityPluginDir: pluginDir,
    antigravityPluginInstalled: pluginInstalled,
  };
}

export function installAntigravityPlugin() {
  const pluginDir = path.join(os.homedir(), ".gemini", "config", "plugins", "site-rea");
  copyDirRecursive(PLUGIN_TEMPLATE_DIR, pluginDir);

  const nodeExec = preferredNodeExecutable();
  const mcpConfig = {
    mcpServers: {
      "site-rea": {
        command: nodeExec,
        args: [BIN_PATH, "mcp"],
      },
    },
  };
  fs.writeFileSync(path.join(pluginDir, "mcp_config.json"), JSON.stringify(mcpConfig, null, 2) + "\n", "utf8");

  const readmeSrc = path.join(PKG_ROOT, "README.md");
  if (fs.existsSync(readmeSrc)) {
    fs.copyFileSync(readmeSrc, path.join(pluginDir, "README.md"));
  }

  return {
    status: "installed",
    pluginDir,
    mcpCommand: `${nodeExec} ${BIN_PATH} mcp`,
    chromeExecutable: resolveChromeExecutable(),
  };
}

export function getSetupInstructions() {
  const nodeExec = preferredNodeExecutable();
  return {
    antigravityOneCommand: `${nodeExec} ${BIN_PATH} install`,
    antigravityPluginDir: path.join(os.homedir(), ".gemini", "config", "plugins", "site-rea"),
    mcpEntry: {
      "site-rea": {
        command: nodeExec,
        args: [BIN_PATH, "mcp"],
      },
    },
    claudeCodeCommand: `claude mcp add site-rea -- ${nodeExec} ${BIN_PATH} mcp`,
    codexConfigToml: `[mcp_servers.site-rea]\ncommand = "${nodeExec}"\nargs = ["${BIN_PATH}", "mcp"]`,
    cursorMcpJson: JSON.stringify(
      {
        mcpServers: {
          "site-rea": {
            command: nodeExec,
            args: [BIN_PATH, "mcp"],
          },
        },
      },
      null,
      2
    ),
  };
}
