# Agent Guide: `datadog-rum-pizza-builder`

A playground and showcase for testing Datadog RUM events and synthetics hosted on GitHub Pages. It's meant to educate and demonstrate RUM and Synthetic Testing features for different use cases and solutions built on the Datadog Real User Monitoring SDKs.

The site is a set of **environments**: the pizza builder home page at the repo root, plus one directory per **lab** (`consent-lab/`, `otel-rum-lab/`, …). All of them build from the single `package.json` at the repo root.

---

## Repo layout

| Path | What it is |
| --- | --- |
| `index.html`, `app.js` | Home environment — the pizza builder |
| `<lab>/index.html`, `<lab>/app.js` | A lab environment |
| `<lab>/src/main.js` | Optional npm-bundled entry for a lab → `<lab>/dist/bundle.js` (gitignored) |
| `tokens.css`, `style.css`, `lab-shared.css`, `lab-shared.js` | Shared design system and page chrome used by every environment |
| `config.template.js` | Template for `config.js` (`window.DD_CONFIG`), the shared Datadog RUM/Logs settings |
| `scripts/` | Build tooling: `labs.js` (discovery), `build.js`, `bundle.js`, `dev.js`, `serve.js`, `upload-sourcemaps.js` |
| `.github/workflows/jekyll-docker.yml` | `build` job (every push and PR): `npm ci` → `npm run build` (+ `npm run sourcemaps:upload` on `main`). `deploy` job (`main` only): publish `_site/` |

## Commands

Run from the repo root.

| Command | What it does |
| --- | --- |
| `npm install` | Installs dependencies for every environment |
| `npm run dev` | Watches every lab bundle and serves the repo root at `http://localhost:8765` with caching disabled |
| `npm run build` | Builds every environment into `_site/` (bundles, `config.js`, placeholders, cache-busting, source maps, validation) |
| `npm run preview` | `build`, then serves `_site/` exactly as it will be deployed |
| `npm run labs` | Lists the environments the build discovered |
| `npm run proxy` | Starts the OTel lab's optional local OTLP proxy |

For local RUM data, `cp config.template.js config.js` and fill in `applicationId` and `clientToken`. `config.js` is gitignored and must never be committed.

---

## Adding a new lab

Labs are **discovered, not registered**. Any top-level directory with an `index.html` is an environment (see `scripts/labs.js`), so a new lab needs **no build-script or workflow changes**. If you find yourself editing `scripts/build.js` or the workflow just to add a lab, stop and rethink the approach.

### 1. Create the directory

- Put it at the **top level** (`my-thing-lab/`, not `labs/my-thing/`). Discovery only looks one level deep.
- Use kebab-case and end the name with `-lab`, matching `consent-lab` and `otel-rum-lab`.
- Don't use a reserved name: `scripts`, `assets`, `_site`, `_reference`, `node_modules`, `sourcemaps-upload`.

### 2. Write `<lab>/index.html`

Start from `consent-lab/index.html` (it uses the RUM/Logs SDKs) or `otel-rum-lab/index.html` (it uses an npm bundle and no Datadog SDK). Keep the same skeleton:

- **`<head>`**, in this order:
  - Web Awesome, pinned to the same version and loaded from `dist-cdn` (not `dist`) — see the comment in `consent-lab/index.html` for why
  - the Datadog RUM / Logs CDN snippets, if the lab uses them
  - `<script src="../config.js"></script>`
  - `../tokens.css`, `../style.css`, `../lab-shared.css`
  - the inline pre-paint theme script, copied as-is (it stays duplicated per page on purpose)
  - a `<style>` block for **page-specific** rules only
- **Layout markup** that `lab-shared.js` expects: `.training-layout` > `aside.training-sidebar` (including `#sidebar-resizer`) + `.training-main`.
- **A `← Back to Pizza Builder` link** with `href="../"` in the sidebar intro, plus the standard sidebar footer.
- **Scripts at the end of `<body>`:** `../lab-shared.js`, then `app.js`, then `dist/bundle.js` if the lab has one.

### 3. Write `<lab>/app.js`

- Page logic goes here. Name it exactly `app.js`: the build only generates and uploads source maps for each environment's `app.js`.
- Initialize the SDKs from `window.DD_CONFIG`, never from hardcoded values:

  ```javascript
  window.DD_RUM && window.DD_RUM.onReady(function () {
    const cfg = window.DD_CONFIG || {};
    window.DD_RUM.init({
      applicationId: cfg.applicationId,
      clientToken: cfg.clientToken,
      site: cfg.site,
      service: cfg.service,
      version: cfg.version,
      env: cfg.env,
      // lab-specific options…
    });
  });
  ```

  `service` and `version` have to match what source maps are uploaded under, or stack frames won't resolve. Every environment shares one RUM application and one service.
- If the lab shows a live event table fed by `beforeSend`, filter out static-asset resources (the Web Awesome autoloader alone pulls ~55 chunks per load) but still `return true` so everything reaches Datadog. `consent-lab/app.js` has the pattern.

### 4. Optional: npm dependencies

- Add packages to the **root** `package.json` (`npm install <pkg>` from the repo root). **Never** add a `package.json`, lockfile or build script inside a lab.
- Put the entry at `<lab>/src/main.js`. `npm run build` and `npm run dev` bundle it to `<lab>/dist/bundle.js` automatically (IIFE, es2020, with a source map).
- Keep UI code in `app.js` and only the SDK/library setup in the bundle. Load the bundle after `app.js`, so anything `app.js` exposes on `window` exists before the bundle runs (see `otel-rum-lab`).

### 5. Know what gets published

`_site/` is built from files git knows about, so gitignored files never ship. These are also excluded:

- dotfiles and `node_modules`
- `scripts/`, `package*.json`, `config.template.js`, `AGENTS.md`, `CLAUDE.md`
- inside a lab: `src/` (the bundle replaces it) and `proxy/`

Local-only tooling (e.g. a Node proxy) belongs in `<lab>/proxy/`, with a root `npm run` script to start it. Secrets go in a gitignored `<lab>/.env`, with a committed `.env.example`.

### 6. Placeholders

`npm run build` fills these in every `.html` and `.md` file:

| Placeholder | Becomes |
| --- | --- |
| `%%PAGES_URL%%` | Site base URL, no trailing slash (empty locally). Write `%%PAGES_URL%%/my-thing-lab/` |
| `%%GITHUB_REPO%%` | `https://github.com/<owner>/<repo>` |
| `%%DD_APP_ID%%` | The RUM application ID. Only needed by pages that don't load `config.js` |

One of these left unreplaced fails the build. Any other `%%NAME%%` text, such as a README documenting placeholders or a typo, only prints a warning and is published as-is. A *new* placeholder is the one case that does need a change in `scripts/build.js` (plus `scripts/env.js`, and a workflow secret if it's sensitive).

### 7. Link it and document it

- Add a link from the home page sidebar intro in `index.html`, below the existing lab links (one `<p>` per lab, starting with the lab's emoji).
- Add a section to the root `README.md` with a `**[Try it →](%%PAGES_URL%%/<lab>/)**` link.
- Add a `<lab>/README.md` covering what it demonstrates, how to run it, and any caveats.

### 8. Verify before calling it done

```bash
npm run labs      # the new lab is listed (with "bundles …" if it has src/main.js)
npm run dev       # open http://localhost:8765/<lab>/ and click through it
npm run build     # completes with no errors; <lab>/app.js appears in the source-maps line
npm run preview   # check http://localhost:8765/<lab>/ as deployed
```

In the browser, check that the shared CSS and JS load (no 404s on `../` paths), the theme toggle and sidebar resizer work, and RUM events show up (in the on-page table if the lab has one, or in devtools).

### 9. Screenshot it in the PR

A PR that adds an environment, or visibly changes one, includes screenshots so reviewers can see it without running it.

- Capture them from `npm run dev` with a headless browser (Playwright works), after driving the page into a state that shows what it does: events in the table, a scenario run, each tab. Include one dark-mode shot.
- Use a 1440px-wide viewport, and convert to WebP (`cwebp -q 85 in.png -o out.webp`) to keep each file around 100 KB.
- Commit them as `assets/<lab>.webp`, `assets/<lab>-<view>.webp`, next to the existing `assets/pizza-builder*.webp`. Reference them from `<lab>/README.md` too (`../assets/<lab>.webp`).
- `gh` can't upload image attachments, so embed them in the PR body by commit-pinned URL, which keeps working after the branch is deleted: `https://raw.githubusercontent.com/<owner>/<repo>/<commit-sha>/assets/<lab>.webp`.
- Don't commit raw PNGs or scratch captures; keep those in a temp directory.

---

## General guidelines

- **Relative paths only.** The site is served from a subpath (`/datadog-rum-pizza-builder/`), so `/tokens.css` breaks in production. Use `../tokens.css`.
- **No `file://`.** Use `npm run dev`, because instrumentation and `fetch` need real HTTP.
- **Pin every CDN version** (never `@latest`), and bump it deliberately across every page at once.
- **Reuse before adding.** Generic components belong in `lab-shared.css` / `lab-shared.js` so every environment gets them; page-specific rules stay in the page's `<style>`. Colors and spacing come from `tokens.css` variables.
- **Measure, don't assert.** Labs teach by showing what the SDK actually did (from `beforeSend`, storage inspectors, etc.). Don't hardcode claims about what Datadog does with the data.
- **Don't edit `_site/` or `<lab>/dist/`.** They are build output and get regenerated.
- **Never commit credentials.** Client tokens come from `config.js` locally and from repo secrets in CI; API keys only ever live in a gitignored `.env`.
