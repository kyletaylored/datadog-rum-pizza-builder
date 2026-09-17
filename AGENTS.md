# Codex Handoff: `datadog-rum-pizza-builder`

## What we're doing

Setting up a GitHub repo called `datadog-rum-pizza-builder`, adding the pizza wizard HTML demo and a README, then enabling GitHub Pages so it's live at `https://<username>.github.io/datadog-rum-pizza-builder/`.

---

## Step 1 — Create the repo

Create a new **public** GitHub repo named `datadog-rum-pizza-builder`. No template, no auto-initialized README (we'll add our own).

```bash
gh repo create datadog-rum-pizza-builder --public --description "Datadog RUM demo — interactive pizza wizard showing views, actions, and beforeSend event capture"
```

---

## Step 2 — Create the project files

Create a local directory and initialize git:

```bash
mkdir datadog-rum-pizza-builder && cd datadog-rum-pizza-builder
git init
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/datadog-rum-pizza-builder.git
```

### `index.html`

Create `index.html` with the contents of the pizza wizard artifact from this conversation (the full single-file HTML page including the Datadog RUM snippet, Pico CSS, wizard UI, and live RUM event log table).

Key things already in the file:

- Datadog RUM SDK loaded from `https://www.datadoghq-browser-agent.com/us1/v6/datadog-rum.js`
- `clientToken: 'pub067eb57994325a05bf401b11a686e8e3'`
- `applicationId: '4a79b017-ea18-4839-9153-ce2b058b4db6'`
- `service: 'datadog-demo-app'`, `env: 'local'`
- `beforeSend` callback feeding the live event log table
- `addAction('pizza_order_submitted', { pizza_order: { ... } })` fired on results screen
- `stopSession()` called on restart

> **Note:** Update `env: 'local'` to `env: 'prod'` (or `'demo'`) before deploying if you want GitHub Pages traffic tagged separately in Datadog.

---

### `README.md`

Create `README.md` with the following content:

---

# 🍕 Datadog RUM Pizza Builder

A self-contained demo app for exploring [Datadog Real User Monitoring (RUM)](https://docs.datadoghq.com/real_user_monitoring/) — built as an interactive pizza order wizard.

**[Live Demo →](https://<YOUR_GITHUB_USERNAME>.github.io/datadog-rum-pizza-builder/)**

---

## What this demonstrates

This app is designed as a hands-on training tool to show how Datadog RUM captures user behavior in a single-page app using URL fragment-based navigation.

### Views

Each wizard step updates the URL hash, triggering a new RUM view:

| Step     | Fragment    |
| -------- | ----------- |
| Crust    | `#crust`    |
| Sauce    | `#sauce`    |
| Cheese   | `#cheese`   |
| Toppings | `#toppings` |
| Size     | `#size`     |
| Results  | `#results`  |

In the RUM Explorer, these appear as distinct views with their own load times, action counts, and frustration signals — even though no page navigation occurred.

### Actions

RUM auto-captures clicks (e.g. "Continue", "Start Over") as `click` actions. The final step also fires a **custom action**:

```javascript
DD_RUM.addAction("pizza_order_submitted", {
  pizza_order: {
    crust: "Hand-Tossed",
    sauce: "BBQ",
    cheese: "Mozzarella",
    toppings: "Pepperoni",
    size: "Large (16 in)",
  },
});
```

In the RUM Explorer, filter by `@action.target.name:pizza_order_submitted` and use `@context.pizza_order.*` attributes as facets to see the full order payload.

### `beforeSend` callback

The RUM SDK is initialized with a `beforeSend` callback that intercepts every event before it's sent to Datadog. The demo uses this to power the live event log table at the bottom of the page — showing event type, view path, URL hash, action names, and context payloads in real time.

```javascript
beforeSend: (event) => {
  logRumEvent(event); // feeds the on-page event table
  return true; // always forward to Datadog
};
```

Returning `false` from `beforeSend` would discard the event. See the [Datadog docs](https://docs.datadoghq.com/real_user_monitoring/guide/enrich-and-control-rum-data/?tab=npm) for enrichment and filtering patterns.

### Session lifecycle

Clicking **Start Over** calls `DD_RUM.stopSession()`, ending the current RUM session. A new session begins on the next user interaction. This is useful for demonstrating session boundaries in training scenarios.

---

## Running locally

Just open `index.html` in a browser — no build step, no server required. Everything is loaded from CDN.

```bash
open index.html
```

---

## Deployment

This repo is deployed via **GitHub Pages** from the `main` branch root. Any push to `main` updates the live demo automatically.

---

## RUM Configuration

| Setting                    | Value                                  |
| -------------------------- | -------------------------------------- |
| Application ID             | `4a79b017-ea18-4839-9153-ce2b058b4db6` |
| Client Token               | `pub067eb57994325a05bf401b11a686e8e3`  |
| Site                       | `datadoghq.com` (US1)                  |
| Service                    | `datadog-demo-app`                     |
| Session Sample Rate        | 100%                                   |
| Session Replay Sample Rate | 100%                                   |
| Privacy Level              | `mask-user-input`                      |

---

## Stack

- [Datadog RUM Browser SDK v6](https://docs.datadoghq.com/real_user_monitoring/browser/)
- [Pico CSS](https://picocss.com/) — minimal classless CSS framework
- Vanilla JS, no build tooling

---

_(End of README)_

---

## Step 3 — Enable GitHub Pages

```bash
# Commit and push
git add .
git commit -m "Initial commit — RUM pizza builder demo"
git branch -M main
git push -u origin main
```

Then enable Pages via the GitHub CLI or manually in repo settings:

```bash
gh api repos/kyletaylored/datadog-rum-pizza-builder/pages \
  --method POST \
  -f build_type=legacy \
  -f source.branch=main \
  -f source.path=/
```

Or in the GitHub UI: **Settings → Pages → Source → Deploy from branch → `main` / `/ (root)`**

The site will be live at:

```
https://kyletaylored.github.io/datadog-rum-pizza-builder/
```

---

## Step 4 — Final touches (optional)

- Update `env: 'local'` → `env: 'demo'` in the RUM init config in `index.html` so GitHub Pages traffic is tagged separately from local testing in Datadog
- Replace `<YOUR_GITHUB_USERNAME>` in the README live demo link with your actual username
- Add a `version` tag to the RUM init (e.g. `version: '1.0.0'`) to track future changes

## Imported Claude Cowork project instructions

A playground and showcase for testing Datadog RUM events and synthetics hosted on Github pages. This is meant to educate and implement various RUM and Synthetic Testing features for different use cases and solutions for Datadog Real User Monitoring SDKs.
