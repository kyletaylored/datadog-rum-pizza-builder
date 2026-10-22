// Builds every environment — the home page and each lab — into _site/,
// ready to publish as-is. This is everything the Pages workflow used to do
// inline, so CI and a local build produce the same output:
//
//   1. esbuild bundles for labs with a src/main.js        (bundle.js)
//   2. copy the publishable files into _site/
//   3. generate _site/config.js from config.template.js
//   4. fill %%PAGES_URL%% / %%GITHUB_REPO%% / %%DD_APP_ID%% in HTML + Markdown
//   5. cache-bust local CSS/JS references with ?v=<sha>
//   6. identity source maps for every app.js entrypoint
//   7. validate: no placeholder left behind, DD_CONFIG fully populated
//
// Nothing here names a lab: environments come from labs.js discovery, so a
// new lab directory needs no build change.
//
// Inputs (all optional locally, see env.js): DD_APP_ID, DD_CLIENT_TOKEN,
// PAGES_URL, VERSION / GITHUB_SHA, GITHUB_REPOSITORY. With CI set, missing
// Datadog credentials are a hard failure instead of a warning.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { minify } from "terser";
import { buildBundles } from "./bundle.js";
import { ROOT, discoverLabs } from "./labs.js";
import { IS_CI, SITE_DIR, ddCredentials, evalConfig, githubRepoUrl, pagesUrl, version } from "./env.js";

const labs = discoverLabs();
const sha = version();
const site = (...p) => path.join(SITE_DIR, ...p);

function fail(message) {
  console.error(`\nERROR: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Bundles

await buildBundles();

// ---------------------------------------------------------------------------
// 2. Copy publishable files
//
// Starts from what git knows about (tracked + untracked-but-not-ignored), so
// a local build publishes exactly what a CI checkout would — never the
// hand-filled config.js, stale *.map files, or gitignored working docs —
// then drops repo tooling that was never part of the site.

const IGNORED_TOP_LEVEL = new Set(["scripts", "package.json", "package-lock.json", "config.template.js", "AGENTS.md", "CLAUDE.md"]);
// Per-lab build inputs and dev-only tooling; the bundle replaces src/.
const IGNORED_IN_LAB = new Set(["src", "proxy"]);
const labDirs = new Set(labs.map((lab) => lab.dir));

function isPublishable(rel) {
  const parts = rel.split("/");
  if (parts.some((p) => p.startsWith(".") || p === "node_modules")) return false;
  if (IGNORED_TOP_LEVEL.has(parts[0])) return false;
  if (parts.length > 2 && labDirs.has(parts[0]) && IGNORED_IN_LAB.has(parts[1])) return false;
  return true;
}

let files;
try {
  files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .filter((rel) => existsSync(path.join(ROOT, rel))); // skip tracked-but-deleted
} catch {
  fail("git ls-files failed — the build needs to run inside the git checkout");
}

rmSync(SITE_DIR, { recursive: true, force: true });
mkdirSync(SITE_DIR, { recursive: true });

const published = files.filter(isPublishable);
for (const rel of published) {
  mkdirSync(path.dirname(site(rel)), { recursive: true });
  cpSync(path.join(ROOT, rel), site(rel));
}

// Bundles are gitignored build output, so git ls-files never lists them.
for (const lab of labs.filter((l) => l.bundle)) {
  for (const out of [lab.bundle.outfile, `${lab.bundle.outfile}.map`]) {
    mkdirSync(path.dirname(site(out)), { recursive: true });
    cpSync(path.join(ROOT, out), site(out));
  }
}

console.log(`Copied ${published.length} file(s) into _site/ for ${labs.length} environment(s): ${labs.map((l) => l.name).join(", ")}`);

// ---------------------------------------------------------------------------
// 3. config.js

const creds = ddCredentials();
if (!creds) {
  const message = "No Datadog credentials — set DD_APP_ID and DD_CLIENT_TOKEN, or create config.js from config.template.js";
  if (IS_CI) fail(message);
  console.warn(`WARNING: ${message}. RUM will not initialize in this build.`);
}

const template = readFileSync(path.join(ROOT, "config.template.js"), "utf8");
writeFileSync(
  site("config.js"),
  creds
    ? template
        .replaceAll("%%DD_APP_ID%%", creds.applicationId)
        .replaceAll("%%DD_CLIENT_TOKEN%%", creds.clientToken)
        .replaceAll("%%VERSION%%", sha)
    : template.replaceAll("%%VERSION%%", sha),
);

// ---------------------------------------------------------------------------
// 4. Template HTML + Markdown

const substitutions = {
  "%%PAGES_URL%%": pagesUrl(),
  "%%GITHUB_REPO%%": githubRepoUrl(),
  // otel-rum-lab never loads config.js but stamps datadog.application.id on
  // every event — same app, same source, so the two never drift apart.
  ...(creds && { "%%DD_APP_ID%%": creds.applicationId }),
};

const templated = published.filter((rel) => rel.endsWith(".html") || rel.endsWith(".md"));
for (const rel of templated) {
  let content = readFileSync(site(rel), "utf8");
  for (const [placeholder, value] of Object.entries(substitutions)) content = content.replaceAll(placeholder, value);
  writeFileSync(site(rel), content);
}

// ---------------------------------------------------------------------------
// 5. Cache-bust local CSS/JS references
//
// Cloudflare fronts the custom domain and caches static assets for up to 4h
// (cache-control: max-age=14400) independent of anything GitHub Pages does —
// a deploy alone doesn't purge it. Appending ?v=<sha> changes the URL every
// deploy, so there's nothing to have gone stale: old cache entries just sit
// unused instead of getting served.

const assetRef = /(href|src)="([^"]+)"/g;
const shouldVersion = (ref) =>
  !/^(https?:)?\/\/|^data:/.test(ref) && !ref.includes("?") && (ref.endsWith(".css") || ref.endsWith(".js"));

const busted = [];
for (const rel of published.filter((r) => r.endsWith(".html"))) {
  const content = readFileSync(site(rel), "utf8");
  const next = content.replace(assetRef, (m, attr, ref) => (shouldVersion(ref) ? `${attr}="${ref}?v=${sha}"` : m));
  if (next !== content) {
    writeFileSync(site(rel), next);
    busted.push(rel);
  }
}
console.log(`Cache-busted assets in ${busted.length} file(s) with ?v=${sha}`);

// ---------------------------------------------------------------------------
// 6. Source maps
//
// Identity maps (no compression, no mangling) for each environment's app.js,
// so Datadog can link stack frames to exact GitHub file + line references.
// `sources` stays repo-relative (e.g. consent-lab/app.js) for that lookup,
// and `file` is set explicitly because datadog-ci uses it to build the JS URL.

const entrypoints = labs.map((lab) => path.posix.join(lab.dir, "app.js")).filter((rel) => existsSync(site(rel)));
if (entrypoints.length === 0) fail("no app.js entrypoints found");

for (const rel of entrypoints) {
  const result = await minify(
    { [rel]: readFileSync(site(rel), "utf8") },
    { compress: false, mangle: false, sourceMap: { url: "app.js.map" } },
  );
  const map = JSON.parse(result.map);
  map.file = "app.js";
  delete map.sourceRoot;
  writeFileSync(site(rel), result.code);
  writeFileSync(site(`${rel}.map`), JSON.stringify(map));
}
console.log(`Generated source maps for ${entrypoints.length} entrypoint(s): ${entrypoints.join(", ")}`);

// ---------------------------------------------------------------------------
// 7. Validate

// Only placeholders this build owns are fatal if left behind. Any other
// %%NAME%% is most likely prose (a README documenting placeholders, say) —
// or a typo, so it's still surfaced, just as a warning.
const OWNED = new Set([...Object.keys(substitutions), "%%DD_APP_ID%%", "%%DD_CLIENT_TOKEN%%", "%%VERSION%%"]);
const unreplaced = [];
for (const rel of [...templated, "config.js"]) {
  for (const [placeholder] of readFileSync(site(rel), "utf8").matchAll(/%%[A-Z_]+%%/g)) {
    if (!OWNED.has(placeholder)) console.warn(`WARNING: unknown placeholder ${placeholder} in ${rel} — left as-is`);
    else if (creds) unreplaced.push(`${placeholder} in ${rel}`);
  }
}
if (unreplaced.length) fail(`unreplaced placeholders: ${[...new Set(unreplaced)].join(", ")}`);

if (creds) {
  const owner = (process.env.GITHUB_REPOSITORY || "kyletaylored/").split("/")[0];
  const cfg = evalConfig(readFileSync(site("config.js"), "utf8"), `${owner}.github.io`);
  const missing = ["applicationId", "clientToken", "site", "service", "version"].filter((k) => !cfg?.[k]);
  if (missing.length) fail(`missing or empty fields in DD_CONFIG: ${missing.join(", ")}`);
  console.log(`config.js OK (credentials from ${creds.source}) — service: ${cfg.service}, version: ${cfg.version}`);
}

for (const rel of entrypoints) {
  const map = JSON.parse(readFileSync(site(`${rel}.map`), "utf8"));
  if (!map.file || !map.mappings) fail(`incomplete source map for ${rel}`);
}

console.log("\nBuilt _site/ — preview with `npm run preview`");
