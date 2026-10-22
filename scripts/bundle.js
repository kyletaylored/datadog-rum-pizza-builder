// esbuild step for every lab that has a src/main.js (see labs.js).
//
// Bundles land next to their lab (<lab>/dist/bundle.js, gitignored) rather
// than only in _site/, so serving the repo root directly (`npm run dev`)
// works with the same relative <script src="dist/bundle.js"> the deployed
// page uses.

import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { ROOT, discoverLabs } from "./labs.js";

function optionsFor(lab) {
  return {
    absWorkingDir: ROOT,
    entryPoints: [lab.bundle.entry],
    outfile: lab.bundle.outfile,
    bundle: true,
    format: "iife",
    target: "es2020",
    sourcemap: true,
    logLevel: "info",
  };
}

export async function buildBundles({ watch = false } = {}) {
  const labs = discoverLabs().filter((lab) => lab.bundle);
  if (watch) {
    for (const lab of labs) {
      const ctx = await esbuild.context(optionsFor(lab));
      await ctx.watch();
      console.log(`watching ${lab.bundle.entry}`);
    }
    return;
  }
  await Promise.all(labs.map((lab) => esbuild.build(optionsFor(lab))));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildBundles({ watch: process.argv.includes("--watch") });
}
