#!/usr/bin/env node
// release-it `after:bump` hook: sync the version that release-it just wrote to
// package.json into the two places the userChrome script is actually consumed —
// the `@version` UserScript header in `index.uc.js` and the `version` field of
// `theme.json` (Sine's manifest) — then stage them so release-it includes them
// in the release commit.
//
// Usage (release-it passes the resolved version):
//   node scripts/set-version.mjs <version>

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_PATH = join(ROOT, "index.uc.js");
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

const VERSION_LINE_RE = /^(\s*\/\/\s*@version\s+)(\S.*)$/m;

function writeIndexVersion(version) {
  const src = readFileSync(INDEX_PATH, "utf8");
  if (VERSION_LINE_RE.test(src)) {
    writeFileSync(INDEX_PATH, src.replace(VERSION_LINE_RE, `$1${version}`));
    return;
  }
  // No @version yet: insert one aligned under @author (or @name as a fallback),
  // matching the value column the other header fields use.
  const anchor =
    /^(\s*\/\/\s*@author)(\s+)(\S.*)$/m.exec(src) ??
    /^(\s*\/\/\s*@name)(\s+)(\S.*)$/m.exec(src);
  if (!anchor) {
    throw new Error("Could not find a UserScript header to insert @version into.");
  }
  const valueColumn = anchor[1].length + anchor[2].length;
  const label = "// @version";
  const pad = " ".repeat(Math.max(1, valueColumn - label.length));
  writeFileSync(INDEX_PATH, src.replace(anchor[0], `${anchor[0]}\n${label}${pad}${version}`));
}

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

  writeIndexVersion(version);
  writeThemeVersion(version);
  execFileSync("git", ["add", "index.uc.js", "theme.json"], { cwd: ROOT, stdio: "inherit" });
}

try {
  main();
} catch (err) {
  console.error(`set-version: ${err.message}`);
  process.exit(1);
}
