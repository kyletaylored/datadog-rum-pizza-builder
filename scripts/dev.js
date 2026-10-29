// Local development: rebuild every lab's bundle on change and serve the repo
// root (not _site/) so edits to HTML/CSS/JS show up on reload with no build
// step. Uses the hand-filled config.js at the root, as before.
//
// `npm run preview` is the other half: the full production build, served
// from _site/ — use it to check templating, cache-busting, or source maps.

import { buildBundles } from "./bundle.js";
import { checkRegistry, discoverLabs } from "./labs.js";
import { serve } from "./serve.js";

const port = Number(process.env.PORT || 8765);

await buildBundles({ watch: true });
serve(".", port);

// Warn rather than exit: a half-registered lab is normal mid-edit, and
// `npm run build` is where it becomes a hard failure.
for (const problem of checkRegistry()) console.warn(`WARNING: ${problem}`);

for (const lab of discoverLabs()) {
  console.log(`  ${lab.name.padEnd(16)} http://localhost:${port}/${lab.dir === "." ? "" : `${lab.dir}/`}`);
}
