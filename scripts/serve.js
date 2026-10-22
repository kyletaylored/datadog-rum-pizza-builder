// Static file server for local preview that defeats browser caching.
//
// Browsers happily serve a stale app.js / style.css from memory cache across
// reloads when a server sends Last-Modified, which makes verifying CSS and JS
// edits unreliable — so every response here is no-store.
//
//   node scripts/serve.js [dir] [--port N]     (dir defaults to the repo root)

import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "./labs.js";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

export function serve(dir, port) {
  const base = path.resolve(ROOT, dir);
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let file = path.join(base, urlPath);
    if (!file.startsWith(base)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) {
      // Mirror GitHub Pages: /lab redirects to /lab/ so relative ../ paths resolve.
      if (!urlPath.endsWith("/")) {
        res.writeHead(301, { Location: `${urlPath}/` }).end();
        return;
      }
      file = path.join(file, "index.html");
    }
    if (!existsSync(file)) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end(`404 ${urlPath}`);
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store, must-revalidate",
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(file).pipe(res);
  });
  server.listen(port, "127.0.0.1", () => console.log(`serving ${path.relative(ROOT, base) || "."}/ at http://localhost:${port}/`));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const portFlag = args.indexOf("--port");
  const port = Number(portFlag === -1 ? process.env.PORT || 8765 : args[portFlag + 1]);
  const dir = args.find((a, i) => !a.startsWith("--") && i !== portFlag + 1) || ".";
  serve(dir, port);
}
