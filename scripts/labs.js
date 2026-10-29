// Lab discovery — the single source of truth for "what environments exist".
//
// An environment is the repo root (the All labs home page) plus any
// top-level directory with an index.html. A lab that also has src/main.js
// gets that entry bundled by esbuild into <lab>/dist/bundle.js. Nothing here
// lists labs by name, so adding a new lab directory needs no build change.
//
// labs.json is the display registry the shell reads (lab rail, All labs
// page). Discovery stays automatic; the registry only adds metadata, and
// checkRegistry() makes the two agree: a lab directory with no entry, or an
// entry with no directory, fails `npm run labs` and `npm run build`.
//
// Run directly (`npm run labs`) to print what the build will pick up.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REGISTRY = path.join(ROOT, "labs.json");

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

const STRING_FIELDS = ["id", "dir", "name", "short", "icon", "category", "blurb"];

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');

// Returns a list of problems; empty means discovery and labs.json agree, and
// each entry's tab labels and topic count match what its page declares.
export function checkRegistry(labs = discoverLabs()) {
  let registry;
  try {
    registry = JSON.parse(readFileSync(REGISTRY, "utf8"));
  } catch (err) {
    return [`labs.json is missing or not valid JSON (${err.message})`];
  }
  if (!Array.isArray(registry)) return ["labs.json must be an array of lab entries"];

  const problems = [];
  const seen = { id: new Set(), dir: new Set() };
  for (const [i, entry] of registry.entries()) {
    const where = `labs.json[${i}]${entry?.id ? ` (${entry.id})` : ""}`;
    for (const field of STRING_FIELDS) {
      if (typeof entry?.[field] !== "string" || !entry[field].trim()) problems.push(`${where}: "${field}" must be a non-empty string`);
    }
    for (const field of ["apis", "tabs"]) {
      if (!Array.isArray(entry?.[field]) || !entry[field].length || entry[field].some((v) => typeof v !== "string")) {
        problems.push(`${where}: "${field}" must be a non-empty array of strings`);
      }
    }
    if (!Number.isInteger(entry?.topics) || entry.topics < 1) problems.push(`${where}: "topics" must be a positive integer`);
    for (const key of ["id", "dir"]) {
      if (seen[key].has(entry?.[key])) problems.push(`${where}: duplicate ${key} "${entry[key]}"`);
      seen[key].add(entry?.[key]);
    }
  }

  const labDirs = labs.filter((lab) => lab.dir !== ".").map((lab) => lab.dir);
  for (const dir of labDirs) {
    if (!seen.dir.has(dir)) problems.push(`${dir}/ has an index.html but no entry in labs.json`);
  }
  for (const entry of registry) {
    if (typeof entry?.dir !== "string") continue;
    if (!labDirs.includes(entry.dir)) {
      problems.push(`labs.json entry "${entry.id}" points at ${entry.dir}/, which isn't a lab directory with an index.html`);
      continue;
    }
    // The shell builds tabs from data-tab-label and topics from .guide-topic,
    // so the registry's counts on the All labs page can't drift from the page.
    const html = readFileSync(path.join(ROOT, entry.dir, "index.html"), "utf8");
    const tabs = [...html.matchAll(/data-tab-label="([^"]+)"/g)].map((m) => decode(m[1]));
    const topics = (html.match(/class="guide-topic"/g) || []).length;
    if (Array.isArray(entry.tabs) && tabs.join("|") !== entry.tabs.join("|")) {
      problems.push(`${entry.dir}/index.html tabs [${tabs.join(", ")}] don't match labs.json [${entry.tabs.join(", ")}]`);
    }
    if (topics !== entry.topics) problems.push(`${entry.dir}/index.html has ${topics} guide topics; labs.json says ${entry.topics}`);
  }
  return problems;
}

// Exits non-zero when checkRegistry() finds anything.
export function assertRegistry(labs) {
  const problems = checkRegistry(labs);
  if (!problems.length) return;
  console.error(`\nERROR: labs.json doesn't match the lab directories:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  console.error("Each lab directory needs a labs.json entry whose tabs and topic count match its page (see AGENTS.md › Building a lab UI).");
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const labs = discoverLabs();
  assertRegistry(labs);
  for (const lab of labs) {
    const where = lab.dir === "." ? "/" : `/${lab.dir}/`;
    console.log(`${lab.name.padEnd(20)} ${where.padEnd(22)} ${lab.bundle ? `bundles ${lab.bundle.entry}` : "static"}`);
  }
}
