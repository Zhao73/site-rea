import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

export function startStaticServer(rootDir, { port = 0, host = "127.0.0.1" } = {}) {
  const resolvedRoot = path.resolve(rootDir);
  if (!fs.existsSync(resolvedRoot)) {
    throw new Error(`Directory does not exist: ${resolvedRoot}`);
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url || "/", `http://${host}`);
        let relPath = decodeURIComponent(reqUrl.pathname);
        if (relPath.endsWith("/")) relPath += "index.html";
        const safePath = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
        let filePath = path.join(resolvedRoot, safePath);

        if (!filePath.startsWith(resolvedRoot)) {
          res.writeHead(403);
          res.end("Forbidden");
          return;
        }

        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, "index.html");
        }

        if (!fs.existsSync(filePath)) {
          if (relPath === "/favicon.ico") {
            res.writeHead(204);
            res.end();
            return;
          }
          // SPA fallback to root index.html for extensionless routes
          const hasExt = path.extname(filePath).length > 0;
          const fallback = path.join(resolvedRoot, "index.html");
          if (!hasExt && fs.existsSync(fallback)) {
            filePath = fallback;
          } else {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Not Found");
            return;
          }
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        res.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "no-store",
        });
        fs.createReadStream(filePath).pipe(res);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(String(err.message || err));
      }
    });

    server.on("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const boundPort = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        server,
        port: boundPort,
        url: `http://${host}:${boundPort}`,
        close: () =>
          new Promise((resClose) => {
            server.close(() => resClose());
          }),
      });
    });
  });
}
