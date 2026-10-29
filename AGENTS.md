# Agent Guide: `datadog-rum-pizza-builder`

A playground and showcase for testing Datadog RUM events and synthetics hosted on GitHub Pages. It's meant to educate and demonstrate RUM and Synthetic Testing features for different use cases and solutions built on the Datadog Real User Monitoring SDKs.

The site is a set of **environments**: the All labs home page at the repo root, plus one directory per **lab** (`pizza-builder-lab/`, `consent-lab/`, `otel-rum-lab/`, …). All of them build from the single `package.json` at the repo root, and all of them share one shell: a lab rail, a lab header with tabs, a guide panel, a docked event log and a status bar.

---

## Repo layout

| Path | What it is |
| --- | --- |
| `index.html`, `app.js` | Home environment — the All labs page, rendered from `labs.json` |
| `<lab>/index.html`, `<lab>/app.js` | A lab environment (the pizza builder is `pizza-builder-lab/`) |
| `<lab>/src/main.js` | Optional npm-bundled entry for a lab → `<lab>/dist/bundle.js` (gitignored) |
| `labs.json` | Lab registry: display metadata for the rail and the All labs page |
| `druids-tokens.css`, `tokens-dark-hc.css` | DRUIDS design tokens (copied, not edited) and the high-contrast dark layer |
| `tokens.css` | This site's `--dd-*` aliases onto DRUIDS semantics |
| `lab-shared.css`, `lab-shared.js` | The shared shell and component kit used by every environment |
| `assets/` | Fonts (`assets/fonts/`), the logo mask, and README / PR screenshots |
| `config.template.js` | Template for `config.js` (`window.DD_CONFIG`), the shared Datadog RUM/Logs settings |
| `scripts/` | Build tooling: `labs.js` (discovery + registry check), `build.js`, `bundle.js`, `dev.js`, `serve.js`, `upload-sourcemaps.js` |
| `.github/workflows/jekyll-docker.yml` | Pages deploy: `npm ci` → `npm run build` → `npm run sourcemaps:upload` → publish `_site/` |

## Commands

Run from the repo root.

| Command | What it does |
| --- | --- |
| `npm install` | Installs dependencies for every environment |
| `npm run dev` | Watches every lab bundle and serves the repo root at `http://localhost:8765` with caching disabled |
| `npm run build` | Builds every environment into `_site/` (registry check, bundles, `config.js`, placeholders, cache-busting, source maps, validation) |
| `npm run preview` | `build`, then serves `_site/` exactly as it will be deployed |
| `npm run labs` | Lists the environments the build discovered, and fails if `labs.json` disagrees |
| `npm run proxy` | Starts the OTel lab's optional local OTLP proxy |

For local RUM data, `cp config.template.js config.js` and fill in `applicationId` and `clientToken`. `config.js` is gitignored and must never be committed.

---

## Adding a new lab

Labs are **discovered, not registered with the build**. Any top-level directory with an `index.html` is an environment (see `scripts/labs.js`), so a new lab needs **no build-script or workflow changes**. If you find yourself editing `scripts/build.js` or the workflow just to add a lab, stop and rethink the approach. The one thing a lab does need is a `labs.json` entry (step 7), which is display metadata, not build config.

### 1. Create the directory

- Put it at the **top level** (`my-thing-lab/`, not `labs/my-thing/`). Discovery only looks one level deep.
- Use kebab-case and end the name with `-lab`, matching `consent-lab` and `otel-rum-lab`.
- Don't use a reserved name: `scripts`, `assets`, `_site`, `_reference`, `node_modules`, `sourcemaps-upload`.

### 2. Write `<lab>/index.html`

Start from `consent-lab/index.html` (it uses the RUM/Logs SDKs) or `otel-rum-lab/index.html` (it uses an npm bundle and no Datadog SDK). Keep the same skeleton:

- **`<head>`**, in this order:
  - the Datadog RUM / Logs CDN snippets, if the lab uses them
  - `<script src="../config.js"></script>`
  - `../druids-tokens.css` → `../tokens-dark-hc.css` → `../tokens.css` → `../lab-shared.css`
  - the inline pre-paint theme script, copied as-is (it stays duplicated per page on purpose)
  - a `<style>` block for **page-specific** rules only
- **Body**: `<div id="lab-content">` with one `<section class="tab-panel" data-tab="…" data-tab-label="…">` per tab, then `<div id="lab-guide" hidden>` with the intro and topics, then the `window.LAB_PAGE` config. See [Building a lab UI](#building-a-lab-ui) below. No rail, header, sidebar or log markup: the shell builds those.
- **Scripts at the end of `<body>`:** the `window.LAB_PAGE` inline script, `../lab-shared.js`, then `app.js`, then `dist/bundle.js` if the lab has one.

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
- Feed the docked log from `beforeSend` with `LabLog.add(…)`. Filter static-asset resources out of the table (stylesheets, fonts and icon masks would bury the events the lab is about), but still `return true` so everything reaches Datadog. `pizza-builder-lab/app.js` has the pattern.

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

### 7. Register it and document it

- Add an entry to `labs.json` (format below). It drives the lab rail and the All labs page; don't hand-add links to other labs anywhere else.
- Add a section to the root `README.md` with a `**[Try it →](%%PAGES_URL%%/<lab>/)**` link.
- Add a `<lab>/README.md` covering what it demonstrates, how to run it, and any caveats.

### 8. Verify before calling it done

```bash
npm run labs      # the new lab is listed (with "bundles …" if it has src/main.js), and no registry error
npm run dev       # open http://localhost:8765/<lab>/ and click through it
npm run build     # completes with no errors; <lab>/app.js appears in the source-maps line
npm run preview   # check http://localhost:8765/<lab>/ as deployed
```

In the browser, check that the shared CSS and JS load (no 404s on `../` paths), the theme toggle works and carries over to other labs, the guide and log resize (drag and arrow keys) and collapse, and RUM events show up (in the docked log, and in devtools › Network as requests to the intake).

### 9. Screenshot it in the PR

A PR that adds an environment, or visibly changes one, includes screenshots so reviewers can see it without running it.

- Capture them from `npm run dev` with a headless browser (Playwright works), after driving the page into a state that shows what it does: events in the log, a scenario run, each tab. Include one dark-mode shot.
- Use a 1440px-wide viewport, and convert to WebP (`cwebp -q 85 in.png -o out.webp`) to keep each file around 100 KB.
- Commit them as `assets/<lab>.webp`, `assets/<lab>-<view>.webp`, next to the existing screenshots. Reference them from `<lab>/README.md` too (`../assets/<lab>.webp`).
- `gh` can't upload image attachments, so embed them in the PR body by commit-pinned URL, which keeps working after the branch is deleted: `https://raw.githubusercontent.com/<owner>/<repo>/<commit-sha>/assets/<lab>.webp`.
- Don't commit raw PNGs or scratch captures; keep those in a temp directory.

---

## Building a lab UI

Every environment uses the same shell and the same visual system. A new lab supplies **content**: topics, tabs, main panels, log columns and statuses. It does **not** supply chrome. If you're writing layout CSS for a rail, header, sidebar, log or status bar inside a lab, stop: it belongs in `lab-shared.css` / `lab-shared.js`, and every lab should get it.

The design reference is the RUM Labs shell handoff (`_reference/design_handoff_rum_labs_shell/`, local only since `_reference/` is gitignored). Its README has the full spec.

### Register it

Add an entry to `labs.json`. `npm run labs` and `npm run build` fail if a lab directory has no entry, if an entry has no directory, or if an entry's `tabs` or `topics` don't match what its page declares.

```json
{ "id": "my-thing", "dir": "my-thing-lab", "name": "My Thing Lab", "short": "My Thing",
  "icon": "<lucide icon name>", "category": "RUM SDK basics | RUM ↔ APM | Privacy & sessions | OpenTelemetry | …",
  "blurb": "One sentence, plain words: what question this lab answers.",
  "apis": ["the", "SDK options", "it teaches"], "tabs": ["Try it", "Config"], "topics": 4 }
```

`tabs` must equal the page's `data-tab-label`s in order, and `topics` its number of `.guide-topic` articles: the All labs page shows those counts without loading the lab.

### Page skeleton

```html
<div id="lab-content">
  <section class="tab-panel" id="tab-try" data-tab="try" data-tab-label="Try it">…</section>
  <section class="tab-panel" id="tab-config" data-tab="config" data-tab-label="Config">…</section>
</div>

<div id="lab-guide" hidden>
  <div class="guide-intro"><p>What this lab is about, in two sentences.</p></div>
  <article class="guide-topic" data-tag="Start" data-title="The two settings, in plain words">
    <p>…</p>
    <pre>optional code</pre>
  </article>
</div>

<script>
  window.LAB_PAGE = {
    id: 'my-thing',                                   // the labs.json id
    log: {
      title: 'Datadog RUM events',
      columns: ['time', 'type', 'name', 'detail'],    // four, cause → effect
      filters: ['view', 'action', { type: 'resource', label: 'xhr/fetch' }],
      off: ['resource'],                              // filters off by default
      hint: 'Optional one line under the log header.',
      empty: 'Waiting for events…',
    },
    status: [
      { id: 'rum', probe: 'rum' },                    // "RUM initialized", from getInitConfiguration()
      { id: 'thing', label: 'Thing starting…', state: 'other' },
    ],
  };
</script>
<script src="../lab-shared.js"></script>
<script src="app.js"></script>
```

Topic prose lives in the page HTML so it stays editable. The shell moves it into the guide panel.

### The shell's API (for `app.js`)

| Call | What it does |
| --- | --- |
| `LabLog.add({ c1, type, c3, c4, label?, sub?, title? })` | Adds a row, newest on top. `type` picks the badge and the filter; cells are text, or `{ html }` for markup you built and escaped yourself |
| `LabLog.setRows(rows)` | Replaces every row (for logs whose rows fill in later; give each a stable `key`) |
| `LabLog.onClear(fn)`, `LabLog.addAction({ label, icon, onClick })` | React to Clear; add a button to the log header |
| `LabStatus.set(id, label, state)` | Updates a status bar item. `state` is one of `success`, `warning`, `danger`, `in-progress`, `other` |
| `LabStatus.setSession(id)`, `LabStatus.setSdk(text)` | Session ID and SDK label (both automatic on pages that load the RUM SDK) |
| `LabShell.onTab(fn)`, `LabShell.showTab(id)`, `LabShell.activeTab()` | Tab changes; `onTab` also calls `fn` right away with the current tab |
| `LabShell.sdkInitConfig('DD_RUM' \| 'DD_LOGS')`, `LabShell.renderJson(el, obj)` | The options the SDK reports it ran with (token masked), and syntax-colored JSON for the Config tab |
| `LabShell.icon(name, size)`, `LabShell.esc(text)` | Icon markup and HTML escaping for strings you build |

### Required on every lab

- **Tabs.** The shell builds the segmented control from your panels. Always include a **Config** tab that shows the real init options this page used (read them back with `LabShell.sdkInitConfig`, not a copied literal).
- **Guide topics.** 3–8 topics. Each has a short tag (one word: Start, Gotcha, Devtools, Backend, Words, …), a title, 1–3 short paragraphs, and an optional code block. Topic 1 orients ("The two settings, in plain words"). At least one says where to look in Datadog (Explorer query, facet or devtools panel).
- **Docked event log.** Feed it from `beforeSend` (or the equivalent processor) through `LabLog`. Pick 4 columns that read left to right as cause → effect. Use existing type badges before adding a new one. A new type gets a badge color in `lab-shared.css`, mapped to a DRUIDS status token.
- **Status bar items.** What's initialized, the consent/export state if it matters, and the current session ID. Status uses the five DRUIDS states (success, warning, danger, in-progress, other). Don't invent a sixth.

### Visual rules (DRUIDS)

- Body 13px Noto Sans. Headings: 23px/700 (page H2), 18px/600 (section, `.section-title`), 15px/600 (card title), 11px/600 uppercase with .06em letter-spacing (`.eyebrow`). Mono is Roboto Mono 12px.
- Controls 28px tall, 4px radius (`.btn`, `.btn--primary`, `.btn--sm`). Cards 8px radius, 1px `--ui-border`, **no shadows** (`.card`). Nothing pill-shaped.
- Primary actions use `--ui-interaction-primary` (blue). The brand purple is only for the logo.
- Colors come from tokens only (`--ui-*`, `--dd-*`). No hex in lab CSS. Test light and dark (`theme-dark theme-dark-hc` on `<html>`).
- Icons: Lucide at the pinned version (`lucide-static@0.460.0`), outline, 14/16/20px, `currentColor`: `<span class="icon icon--14" data-icon="send"></span>`. A new icon needs one `[data-icon]` line in `lab-shared.css`. **No emoji** in UI.
- Text left-aligned. Center only an empty or start state. Prose max ~76ch. Tables and the log use full width.
- Numbered walkthroughs use the shared step heading (`.step-heading` with a `.step-num` circle and a 15px/600 title).
- Copy: plain, short sentences that say what happens. No marketing tone or exclamation marks.

### Before the PR

Check the lab in light and dark at 1440px and at 860px: guide open/closed, log resized and collapsed, every tab. Then follow §8–9 (verify + screenshots).

---

## General guidelines

- **Relative paths only.** The site is served from a subpath (`/datadog-rum-pizza-builder/`), so `/tokens.css` breaks in production. Use `../tokens.css`.
- **No `file://`.** Use `npm run dev`, because instrumentation and `fetch` need real HTTP.
- **Pin every CDN version** (never `@latest`), and bump it deliberately across every page at once.
- **Reuse before adding.** Generic components belong in `lab-shared.css` / `lab-shared.js` so every environment gets them; page-specific rules stay in the page's `<style>`. Colors and spacing come from `tokens.css` / DRUIDS variables.
- **Measure, don't assert.** Labs teach by showing what the SDK actually did (from `beforeSend`, storage inspectors, `getInitConfiguration()`, etc.). Don't hardcode claims about what Datadog does with the data.
- **Don't edit `_site/` or `<lab>/dist/`.** They are build output and get regenerated.
- **Never commit credentials.** Client tokens come from `config.js` locally and from repo secrets in CI; API keys only ever live in a gitignored `.env`.
