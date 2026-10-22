// Build-time settings, resolved the same way for `npm run build` and
// `npm run sourcemaps:upload` so the release version and URL prefix the
// source maps are uploaded under always match what the build stamped into
// config.js.
//
// Every value comes from an env var in CI and falls back to something
// sensible locally, so a plain `npm run build` works on a laptop with no
// setup beyond a hand-filled config.js.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { ROOT } from "./labs.js";

export const SITE_DIR = path.join(ROOT, "_site");
export const IS_CI = Boolean(process.env.CI);

function git(...args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

// Short SHA, matching the ${GITHUB_SHA:0:7} the workflow used to compute.
export function version() {
  if (process.env.VERSION) return process.env.VERSION;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  return git("rev-parse", "--short=7", "HEAD") || "dev";
}

// No trailing slash: templates write "%%PAGES_URL%%/" and "%%PAGES_URL%%/assets/...".
// Empty locally, which turns those into root-relative paths.
export function pagesUrl() {
  return (process.env.PAGES_URL || "").replace(/\/+$/, "");
}

export function githubRepoUrl() {
  if (process.env.GITHUB_REPOSITORY) return `https://github.com/${process.env.GITHUB_REPOSITORY}`;
  const remote = git("remote", "get-url", "origin");
  const match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
  return match ? `https://github.com/${match[1]}` : "https://github.com/kyletaylored/datadog-rum-pizza-builder";
}

// Datadog credentials. CI passes them as env vars (from repo secrets); a
// local build falls back to the hand-filled, gitignored config.js the
// config.template.js header tells you to create.
export function ddCredentials() {
  const { DD_APP_ID, DD_CLIENT_TOKEN } = process.env;
  if (DD_APP_ID && DD_CLIENT_TOKEN) return { applicationId: DD_APP_ID, clientToken: DD_CLIENT_TOKEN, source: "env" };

  const localConfig = path.join(ROOT, "config.js");
  if (existsSync(localConfig)) {
    const cfg = evalConfig(readFileSync(localConfig, "utf8"), "localhost");
    if (cfg?.applicationId && cfg?.clientToken && !cfg.applicationId.includes("%%")) {
      return { applicationId: cfg.applicationId, clientToken: cfg.clientToken, source: "config.js" };
    }
  }
  return null;
}

// Runs a config.js-shaped script against a fake `window` and returns DD_CONFIG.
export function evalConfig(source, hostname) {
  const window = { location: { hostname } };
  vm.runInNewContext(source, { window });
  return window.DD_CONFIG;
}
