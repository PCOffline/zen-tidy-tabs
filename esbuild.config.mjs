import { readFileSync } from "node:fs";
import { build } from "esbuild";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

const banner = `// ==UserScript==
// @name           Zen Tidy Tabs
// @description    Arc-style AI tab tidying integrated into Zen's native sidebar.
//                 A hover-reveal "Tidy" control clusters the open tabs via an
//                 LLM (OpenRouter) into native Zen tab groups. Right-click a
//                 group label to rename / recolor it; left-click renames inline.
// @author         PCOffline
// @version        ${version}
// @include        main
// ==/UserScript==`;

await build({
  entryPoints: ["src/index.ts"],
  outfile: "index.uc.js",
  bundle: true,
  format: "iife",
  target: "esnext",
  banner: { js: banner },
  charset: "utf8",
  logLevel: "info",
  minify: true,
});
