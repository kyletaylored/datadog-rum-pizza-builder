# PRD: Replace Pico CSS with a Modern UI Framework

**Status:** Draft
**Owner:** Kyle Taylor
**Repo:** `datadog-rum-pizza-builder`
**Last updated:** 2026-09-16

## 1. Problem statement

The playground currently styles every page (`index.html`, `consent-lab/index.html`, and any future `/some-lab/`) with [Pico CSS v2.0.6](https://picocss.com/), loaded classless from a CDN. Pico gives us clean typography and basic form/button theming almost for free, which was the right call to get the pizza builder shipped quickly. But the site's ambition has grown — it's now a multi-page training tool meant to showcase Datadog RUM to customers and internally — and Pico's minimalism reads as "unfinished" rather than "intentionally simple." Feedback is that the UI lacks visual polish and doesn't hold attention the way a demo meant to impress a prospect should.

At the same time, we've already hand-built a fair amount of bespoke UI on top of Pico (badges, log tables, storage cards, a resizable sidebar, tag pills) that isn't Pico at all — it's custom CSS that happens to borrow Pico's color variables (`var(--pico-primary)`, `var(--pico-muted-border-color)`, etc.) for theming. Any framework swap has to account for that coupling, not just the handful of native elements (buttons, switches, `<details>`, `<progress>`) that Pico actually styles.

This PRD proposes replacing Pico with a more visually complete framework, while explicitly preserving every component and interaction pattern already built, and fixing the styling coupling so the *next* framework swap is cheaper than this one.

## 2. Goals

- Noticeably improve visual polish (depth, color, motion, type hierarchy) across every page without a full redesign of the site's information architecture.
- Preserve 100% of existing functionality: every component listed in §4 must have a working equivalent after migration.
- Keep the project's zero-build-step philosophy intact — no bundler, no npm install, no CI build stage for the frontend. Everything still loads from a CDN and runs by opening `index.html`.
- Decouple our custom CSS (badges, cards, tables, tags, resizer) from framework-specific variable names, so future framework changes don't require touching every custom component.
- Ship the migration in phases that keep the site deployable (and each lab individually testable) at every step.

## 3. Non-goals

- Rewriting the pizza-wizard flow, the consent lab's demo logic, or any RUM/Logs instrumentation. This is a styling/UI-layer migration only.
- Introducing a JS framework (React, Vue, etc.) or a component compiler. The site stays vanilla JS.
- Picking a framework that requires Node/npm at build time (rules out Tailwind/DaisyUI in their standard production setup — see §6).
- A visual rebrand beyond adopting the new framework's design language (no new logo, no new color identity beyond what's needed for dark/light theming).

## 4. Current-state inventory

This is the checklist any candidate framework (or our own component layer) must satisfy. It's split into "native elements Pico styles today" and "custom components we already built that merely borrow Pico's CSS variables."

### 4.1 Elements Pico styles directly

| Element | Where used | Notes |
|---|---|---|
| Buttons — primary, `.secondary`, `.secondary.outline` | Wizard nav, consent banner, mode picker, tab toolbars, reset/clear/throw-error buttons | Heaviest-used Pico feature by far |
| Form switch (`role="switch"` checkbox) | Dark/light theme toggle (both pages) | Pico's styled checkbox-as-switch |
| `<progress>` | Wizard step progress bar | Native element, Pico-styled |
| `<details>` / `<summary>` | Sidebar "training topics" accordion (6 sections on the pizza builder, 6 on consent-lab) | Native disclosure widget, Pico removes the default marker so we can style our own chevron |
| Base typography, spacing, color tokens | Everywhere | `--pico-primary`, `--pico-muted-color`, `--pico-muted-border-color`, `--pico-card-background-color`, `--pico-card-sectioning-background-color`, `--pico-code-background-color` are referenced throughout `style.css` and `lab-shared.css` |
| `data-theme="light"/"dark"` attribute switching | `<html>` root, toggled via JS, persisted to `localStorage` | This is Pico's dark-mode mechanism; our own JS drives it |

### 4.2 Custom components already built (framework-agnostic logic, Pico-variable-dependent styling)

| Component | Files | Description |
|---|---|---|
| Tab strip (`role="tablist"`/`role="tab"`/`role="tabpanel"`) | `style.css` `.tab-nav`/`.tab-btn`/`.tab-panel`, driven by `switchTab()` / `switchLabTab()` | Fully custom, ARIA-compliant, no Pico or JS-framework dependency |
| Sidebar layout + resizable divider | `style.css` `.training-layout`/`.training-sidebar`/`.training-main`, `lab-shared.css` `.sidebar-resizer`, `lab-shared.js` drag logic | CSS grid + a hand-rolled drag handle; shared across pages via `lab-shared.css`/`.js` |
| Sidebar topic tags | `.sidebar-tag` + `.tag-view`/`.tag-action`/`.tag-funnel`/`.tag-metric`/`.tag-slo` (style.css) and `.tag-consent`/`.tag-storage`/`.tag-tabs`/`.tag-error` (lab-shared.css) | Small colored pills labeling each accordion topic |
| Event/type badges | `.type-badge` + per-type color modifiers (`view`/`action`/`resource`/`error`/`long_task`/`rum`/`logs`/`warn`/`info`/`debug`) | Used in the live activity log table on both pages |
| Live activity log table | `#rum-log-wrap`, `#rum-table`, filter buttons (`.filter-btn`), colorized JSON payloads (`.json-key`/`.json-str`/`.json-num`/`.json-bool`/`.json-null`) | Fed live by `DD_RUM`/`DD_LOGS` `beforeSend` callbacks; sticky table header, scrollable body |
| Storage inspector cards | `.storage-grid`/`.storage-card` (lab-shared.css) | Live `document.cookie` / `localStorage` readout, two-column card grid |
| Consent state pill | `.consent-state-pill` (+ `granted`/`not-granted`/`pending`) | Tri-state colored badge |
| Mode picker | `.mode-picker` (+ `button.active`) | Button group with an active/selected state, used for `sessionPersistence` mode switching |
| Comparison table | `.compare-table`/`.compare-table-wrap` | Small scrollable table inside a sidebar accordion panel |
| Callout / warning box | `.lab-callout` | Left-border-accented box for the "not legal advice" disclaimer |
| Session/tab-id monospace badges | `.session-id`/`.tab-badge` | Tiny code-styled chips |
| Pizza wizard option cards | `.option-card`/`.options` (style.css) | Emoji + label + description selectable cards, one per wizard step |
| Embedded dashboard frame | `.dashboard-iframe` | Results tab, embeds a Datadog dashboard |
| Config viewer | `.config-code` + colorized JSON | Read-only syntax-highlighted config display |

**Takeaway:** most of what makes this site feel like "our" product is already custom CSS, not Pico. Pico is really only responsible for buttons, the switch, `<details>` chevrons, `<progress>`, and the color token system everything else quietly depends on. That last point — the dependency — is the real migration risk, not the button styling.

## 5. Requirements

### Functional
1. Every row in §4 must have a working, visually-equivalent-or-better implementation post-migration.
2. Dark/light theming must continue to work and remain a single JS-driven toggle persisted across pages via `localStorage`.
3. The resizable sidebar, live-updating tables, and accordion topics must continue to work exactly as before — this is a styling migration, not a behavior change.

### Non-functional
4. **Zero build step.** Installable via `<link>`/`<script>` CDN tags only. No `npm install`, no bundler, no change to the GitHub Actions deploy workflow's assumption that `app.js`/`consent-lab/app.js` are the only JS files it needs to minify and source-map.
5. **No new backend/runtime dependency.** Static GitHub Pages hosting only.
6. **Accessibility parity or better.** Current tab/tablist/tabpanel and switch roles are hand-coded correctly; the new framework's components must be at least as accessible (ideally we delete hand-rolled ARIA wiring in favor of the framework's own, if it's solid).
7. **Reasonable payload.** The current CSS payload is Pico (\~28KB min) + our own `style.css`/`lab-shared.css` (\~10KB combined). We should not blow this up by an order of magnitude for a static demo site.
8. **Theming must be token-based**, not hardcoded hex values sprinkled through component CSS (already a problem today — see §7).

## 6. Options considered

| Option | What it is | Build step? | JS included? | Fit |
|---|---|---|---|---|
| **A. Stay on Pico, invest in custom polish** | Keep Pico v2.0.6, spend effort on our own design tokens, shadows, motion, illustration instead of swapping frameworks | No | No | Lowest risk, lowest reward — may not resolve the "lacking visual attraction" complaint since Pico's minimalism is the point of Pico |
| **B. Bootstrap 5.4** | Mature, batteries-included framework; CSS + optional JS bundle (`bootstrap.bundle.min.js`) for its own tabs/accordion/switches | No (CDN) | Yes, if we adopt its components | Safe, extremely well documented, huge community. Aesthetic is generic unless themed; adopting Bootstrap's own tab/accordion JS would mean deleting and replacing our hand-rolled versions |
| **C. Bulma** | CSS-only modern framework, flexbox-based, ~26KB gzipped, no JS | No (CDN) | No | Lightweight and modern-looking, but has no switch/tabs/accordion components at all — we'd keep 100% of our current JS and ARIA wiring, just restyle. Good middle ground but doesn't move the needle on "polish" as much as a component library would |
| **D. UIkit** | CSS + optional JS, 50+ components | No (CDN) | Optional | More component coverage than Bulma, still CDN-friendly, but the aesthetic is dated compared to newer options and the project is less actively trending |
| **E. Web Awesome (formerly Shoelace)** | Framework-agnostic Web Components (`<wa-button>`, `<wa-switch>`, `<wa-tab-group>`, `<wa-details>`, `<wa-badge>`, `<wa-card>`, `<wa-progress-bar>`, etc.), rebuilt on cascade layers + OKLCH theming, MIT-licensed, autoloader script from jsDelivr | No (CDN autoloader) | Yes — Custom Elements, framework-agnostic | Best visual/technical fit (see §8), but younger project (Shoelace→Web Awesome transition completed in 2026) and requires adopting custom-element markup rather than plain HTML |
| **F. Tailwind CSS / DaisyUI** | Utility-first CSS; DaisyUI adds component classes on top | **Yes, for production** (the CDN "Play" build is explicitly not recommended for production use) | No | **Rejected** — violates the zero-build requirement (§5.4) unless we're willing to add a build stage, which is a bigger process change than a styling swap |

## 7. Recommendation

**Adopt Web Awesome (Option E) as the primary UI layer, fronted by a design-token abstraction layer we own.**

Rationale:
- It's the only option that meaningfully upgrades visual polish (OKLCH-based color system, built-in light/dark themes, real elevation/shadow/motion primitives) *and* keeps the zero-build constraint intact via its CDN autoloader.
- Its component catalog maps almost one-to-one onto what we've already built by hand: `wa-tab-group`/`wa-tab`/`wa-tab-panel` can replace our custom tab strip's *styling* (we can keep our JS if we want, or adopt its behavior), `wa-switch` replaces the Pico switch for the theme toggle, `wa-details` replaces the native accordion with more styling control, `wa-badge` gives us a real badge primitive instead of hand-rolled `.type-badge` CSS, `wa-card` formalizes `.storage-card`, `wa-progress-bar` replaces `<progress>`.
- Being Web Components, adoption can be incremental — a `<wa-button>` can sit next to a plain Pico `<button>` on the same page during migration, which fits our phased plan (§9).
- It is MIT-licensed with no required paid tier for anything in this doc's scope.

Primary risk: it's a young rebrand (Shoelace's repo was archived in March 2026 in favor of Web Awesome), so expect rougher edges and a smaller Stack Overflow footprint than Bootstrap. If that risk is judged unacceptable, **Bootstrap 5.4 is the recommended fallback** — much larger ecosystem, still CDN-only, at the cost of a more generic look and a larger JS bundle if we adopt its interactive components.

**Not recommended, but worth stating explicitly:** swapping frameworks alone may not fully solve "lacking visual attraction." A meaningful share of the current flatness is our own custom CSS (badges, cards, log tables) using default spacing/shadows/no motion — that needs deliberate design attention regardless of which base framework sits underneath it. Budget time for that, not just the swap.

## 8. Proposed architecture

### 8.1 Design-token abstraction layer

Today, `style.css` and `lab-shared.css` reference Pico's variables directly (`var(--pico-primary)`, `var(--pico-muted-border-color)`, etc.). That means every custom component is silently coupled to Pico. Before swapping frameworks, introduce our own token layer:

```css
/* tokens.css — new file, loaded first */
:root {
  --dd-color-primary: var(--wa-color-brand-fill-loud, #632ca6);
  --dd-color-muted: var(--wa-color-neutral-fill-normal, #6b7280);
  --dd-color-border: var(--wa-color-neutral-border-normal, #e5e7eb);
  --dd-color-surface: var(--wa-color-neutral-fill-quiet, #f9fafb);
  --dd-color-code-bg: var(--wa-color-neutral-fill-quieter, #f3f4f6);
  /* ...etc. */
}
```

Then every custom component in `style.css`/`lab-shared.css` is edited once to reference `var(--dd-*)` instead of `var(--pico-*)`. After that, swapping the underlying framework is a one-file change to `tokens.css`, not a hunt through every component. This is worth doing even if the team picks Option A (stay on Pico) — it's the fix for the coupling problem regardless of which framework wins.

### 8.2 Component mapping

| Today | After migration (Web Awesome) |
|---|---|
| `<button class="secondary outline">` | `<wa-button variant="neutral" outline>` |
| `<input type="checkbox" role="switch">` | `<wa-switch>` |
| `<details><summary>...</summary>...</details>` | `<wa-details summary="...">...</wa-details>` |
| `<progress value="0" max="5">` | `<wa-progress-bar value="0">` |
| `.type-badge`, `.tag-*`, `.consent-state-pill` | `<wa-badge variant="...">` (custom color modifiers kept as our own CSS on top, since Web Awesome's palette won't cover every semantic color we invented) |
| `.storage-card` | `<wa-card>` |
| `.tab-nav`/`.tab-btn`/`.tab-panel` | `<wa-tab-group>`/`<wa-tab>`/`<wa-tab-panel>` (evaluate keeping our own JS vs. adopting theirs — see open questions) |
| `.training-layout`/`.training-sidebar`/`.sidebar-resizer` | **Kept as-is.** This is bespoke layout, not something any framework provides |
| Live log table, colorized JSON, comparison table | **Kept as-is**, just re-themed via the new token layer |

## 9. Migration plan

Phased so the site is deployable and each lab is independently verifiable after every phase.

**Phase 0 — Token layer (no visual change).**
Introduce `tokens.css`, repoint every `var(--pico-*)` reference in `style.css`/`lab-shared.css` to `var(--dd-*)`, aliased to Pico's current values. Ship this alone first; if nothing looks different, the abstraction is correct.

**Phase 1 — Load Web Awesome alongside Pico.**
Add the autoloader script and base stylesheet to both pages behind the token layer. No markup changes yet. Verify no conflicts (cascade layers should prevent this, but confirm).

**Phase 2 — Migrate the main pizza builder (`index.html`).**
Swap native elements for Web Awesome equivalents per §8.2, one component type at a time (buttons first, then the switch, then `<details>`, then `<progress>`). Re-theme `.option-card`, `.result-list`, etc. against the new tokens. Ship and verify RUM still fires correctly (this is a styling change; instrumentation should be untouched, but the deploy pipeline's source-map upload step is worth a smoke test).

**Phase 3 — Migrate `consent-lab/` and `lab-shared.*`.**
Same component-by-component swap. Since `lab-shared.css`/`.js` are shared, this phase also benefits any future lab automatically.

**Phase 4 — Remove Pico.**
Delete the Pico `<link>` tag from both pages once nothing references `--pico-*` or relies on Pico's base styles. Grep the repo for `pico` to confirm zero remaining references before removing.

**Phase 5 — Design pass.**
With the new component layer in place, spend dedicated time on the things a framework swap doesn't automatically fix: motion/transitions on tab switches and the live log table, elevation/shadow on cards, empty states, and the overall color story (this is where the "visual attraction" complaint actually gets addressed).

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Web Awesome is a young rebrand; breaking changes possible | Pin the exact CDN version (no `@latest`), re-evaluate before any version bump |
| Custom-element markup increases HTML verbosity vs. plain Pico buttons | Accept as a one-time cost; the payoff is per-component theming control |
| Web Awesome's component catalog doesn't cover every custom badge/tag color we've invented | Keep our own `.tag-*`/`.type-badge` color modifiers as a thin CSS layer on top of `<wa-badge>`, don't force everything into the framework's default palette |
| Deploy workflow assumes `app.js`/`consent-lab/app.js` are the only JS needing minification/source-maps; adding framework JS changes that assumption if we ever self-host it | Stay CDN-hosted for the framework itself (not bundled into `app.js`), so the existing terser/source-map step is untouched |
| Migration regresses RUM/Logs instrumentation because DOM structure changes (e.g., `beforeSend` logic or click-action names derived from button text) | Smoke-test the activity log on both pages after each phase; re-check `DD_RUM.addAction`/click-action names since Web Awesome's shadow DOM can affect how RUM's automatic action-name inference reads button text |
| Team judges the risk/effort not worth it | Fall back to Option A (stay on Pico) — but still do Phase 0 (token layer), since that's valuable regardless |

## 11. Success metrics

- All items in §4 have a shipped, working equivalent (binary checklist, tracked as a follow-up issue per phase).
- Zero `pico` references remain in the repo post-Phase 4 (`grep -ri pico` returns nothing outside this PRD and git history).
- No regression in RUM/Logs event capture — the live activity log on both pages shows the same event types (`view`/`action`/`resource`/`error`/`long_task`/`rum`/`logs`) before and after migration.
- Page weight (CSS + framework JS) stays under ~150KB gzipped total (rough budget, not a hard gate) — sanity check against Pico's current footprint.
- Subjective: a "does this look more polished" gut-check from whoever raised the original complaint, post-Phase 5.

## 12. Open questions

1. Do we adopt Web Awesome's own `<wa-tab-group>` behavior for tabs, or keep our hand-rolled `switchTab()`/`switchLabTab()` JS (which also drives the hash-based RUM view tracking) and only take Web Awesome's *styling*? Leaning toward keeping our own JS, since it's already wired to RUM view tracking in a way we understand.
2. Should the resizable sidebar (`lab-shared.js`) stay fully custom, or is there a Web Awesome primitive (e.g., a splitter/resize component) worth adopting instead?
3. How much of Phase 5 (design pass) is in scope for this project vs. a separate follow-up?
4. Do we want to pin Web Awesome to a specific npm-published version via jsDelivr (recommended) or track their rolling CDN tag?
