// Lab discovery — the single source of truth for "what environments exist".
//
// An environment is the repo root (the home page) plus any top-level
// directory with an index.html. A lab that also has src/main.js gets that
// entry bundled by esbuild into <lab>/dist/bundle.js. Nothing here lists
// labs by name, so adding a new lab directory needs no build change.
//
// Run directly (`npm run labs`) to print what the build will pick up.

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Top-level directories that are never environments, even with an index.html.
const NOT_LABS = new Set(["node_modules", "scripts", "_site", "_reference", "sourcemaps-upload", "assets"]);

export function discoverLabs() {
  const labs = [{ name: "home", dir: "." }];
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || NOT_LABS.has(entry.name)) continue;
    if (existsSync(path.join(ROOT, entry.name, "index.html"))) {
      labs.push({ name: entry.name, dir: entry.name });
    }
  }
  return labs.map((lab) => {
    const entry = path.join(lab.dir, "src", "main.js");
    return existsSync(path.join(ROOT, entry))
      ? { ...lab, bundle: { entry, outfile: path.join(lab.dir, "dist", "bundle.js") } }
      : lab;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const lab of discoverLabs()) {
    const where = lab.dir === "." ? "/" : `/${lab.dir}/`;
    console.log(`${lab.name.padEnd(16)} ${where.padEnd(18)} ${lab.bundle ? `bundles ${lab.bundle.entry}` : "static"}`);
  }
}
