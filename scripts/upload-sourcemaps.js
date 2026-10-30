// Uploads the source maps `npm run build` generated in _site/ to Datadog.
//
// Each app.js + map is staged under the same relative path Pages serves it
// at, and datadog-ci joins that path onto --minified-path-prefix:
//   app.js             -> $PAGES_URL/app.js
//   consent-lab/app.js -> $PAGES_URL/consent-lab/app.js
// Staging also keeps datadog-ci's basePath handling from stripping the dot
// out of 'app.js' when uploading from '.'.
//
// Requires DATADOG_API_KEY and PAGES_URL. --service and --release-version
// must match the `service` and `version` tags on the RUM/Logs events, or
// frames won't resolve. Each environment reports its own service
// (serviceFor() in labs.js), so each one is staged and uploaded on its own;
// version comes from the same env.js the build used.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { ROOT, discoverLabs, serviceFor } from "./labs.js";
import { SITE_DIR, evalConfig, pagesUrl, version } from "./env.js";

const STAGE = path.join(ROOT, "sourcemaps-upload");

if (!process.env.DATADOG_API_KEY) {
  console.error("ERROR: DATADOG_API_KEY is not set");
  process.exit(1);
}
if (!pagesUrl()) {
  console.error("ERROR: PAGES_URL is not set — it's the URL prefix the minified files are served from");
  process.exit(1);
}

const entrypoints = discoverLabs()
  .map((lab) => ({ dir: lab.dir, rel: path.posix.join(lab.dir, "app.js") }))
  .filter(({ rel }) => existsSync(path.join(SITE_DIR, `${rel}.map`)));
if (entrypoints.length === 0) {
  console.error("ERROR: no source maps in _site/ — run `npm run build` first");
  process.exit(1);
}

const { service: prefix } = evalConfig(readFileSync(path.join(SITE_DIR, "config.js"), "utf8"), "localhost");

try {
  for (const { dir, rel } of entrypoints) {
    rmSync(STAGE, { recursive: true, force: true });
    mkdirSync(path.join(STAGE, path.dirname(rel)), { recursive: true });
    for (const f of [rel, `${rel}.map`]) cpSync(path.join(SITE_DIR, f), path.join(STAGE, f));
    execFileSync(
      "npx",
      [
        "--yes", "@datadog/datadog-ci", "sourcemaps", "upload", STAGE,
        "--service", serviceFor(prefix, dir),
        "--release-version", version(),
        "--minified-path-prefix", `${pagesUrl()}/`,
      ],
      { cwd: ROOT, stdio: "inherit" },
    );
  }
} finally {
  rmSync(STAGE, { recursive: true, force: true });
}
