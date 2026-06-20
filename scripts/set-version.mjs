#!/usr/bin/env node
// release-it `after:bump` hook: rebuild index.uc.js (esbuild reads the version
// from package.json) and sync the version into theme.json, then stage both so
// release-it includes them in the release commit.
//
// Usage (release-it passes the resolved version):
//   node scripts/set-version.mjs <version>

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const THEME_PATH = join(ROOT, "theme.json");

const THEME_DEFAULTS = {
  name: "Zen Tidy Tabs",
  description: "Arc-style AI tab tidying in Zen's native sidebar.",
  author: "PCOffline",
  homepage: "https://github.com/PCOffline/zen-tidy-tabs",
  scripts: {
    "index.uc.js": { include: ["*browser.xhtml*"] },
  },
};

function writeThemeVersion(version) {
  let theme;
  try {
    theme = { ...JSON.parse(readFileSync(THEME_PATH, "utf8")), version };
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw new Error(`theme.json exists but is not valid JSON: ${err.message}`);
    }
    const { scripts, ...rest } = THEME_DEFAULTS;
    theme = { ...rest, version, scripts };
  }
  writeFileSync(THEME_PATH, `${JSON.stringify(theme, null, 2)}\n`);
}

function main() {
  const version = process.argv[2];
  if (!version) throw new Error("Expected a version argument, e.g. `set-version.mjs 1.2.3`.");

  execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
  writeThemeVersion(version);
  execFileSync("git", ["add", "index.uc.js", "theme.json"], { cwd: ROOT, stdio: "inherit" });
}

try {
  main();
} catch (err) {
  console.error(`set-version: ${err.message}`);
  process.exit(1);
}
