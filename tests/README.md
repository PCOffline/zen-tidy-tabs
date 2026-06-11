# Zen Tidy Tabs — end-to-end tests

These tests drive a **real Zen browser** and exercise the `index.uc.js`
userChrome script the way a user would: clicking the Tidy control,
right-clicking it, renaming group badges, and tidying tabs.

The suite is written in **TypeScript (ESM)**, linted/formatted with **Biome**,
and run with **`@playwright/test`** as the runner.

## Why not "pure" Playwright?

Everything this script touches lives in the **browser chrome** (`browser.xhtml`):
the Tidy control in the sidebar, the `<tab-group>` badges, and the modals it
appends to the chrome window. Playwright automates *web-page content* and cannot:

1. launch Zen (its Firefox build requires the Juggler protocol patches Zen lacks), or
2. reach chrome UI even with its own Firefox.

So the browser is driven with **`selenium-webdriver` + geckodriver in Marionette
chrome context**, which is the standard, working way to automate Firefox/Zen
chrome and userChrome scripts. We still use **`@playwright/test` as the runner**
(fixtures, retries, HTML report) so the developer experience stays familiar.

## What's covered

| Spec | Requirement |
| --- | --- |
| `specs/tidy-button.spec.ts` | The Tidy button exists; its placement (twin of Clear, or the documented fallback) is correct |
| `specs/settings.spec.ts` | Right-clicking the button opens the Zen Tidy Tabs configuration modal |
| `specs/tidying.spec.ts` | Tidying actually works (the OpenRouter call is stubbed; tabs are sorted into native groups) |
| `specs/group-badge.spec.ts` | Single-click renames a badge inline; double-click opens the rename + recolor modal |

The script under test is read straight from `../index.uc.js` and injected into
the chrome window, so the tests always run against the current source.

## Requirements

- **Zen Browser** installed. Default path is `C:\Program Files\Zen Browser\zen.exe`;
  override with the `ZEN_BINARY` env var.
- **Node.js 24+** (the suite is native ESM).
- Internet access on first run: a matching **geckodriver** is downloaded
  automatically into `./.geckodriver/` (cached for later runs). Set
  `GECKODRIVER_PATH` to use an existing binary instead.
- Run with a desktop session (headed). Headless Firefox exposes the chrome DOM
  but reports elements as not-displayed, which breaks real clicks. You can set
  `ZEN_HEADLESS=1` to try headless, but it isn't recommended.
- Close other running Zen windows before the run (the tests launch their own
  isolated, throwaway profile with `-no-remote`).

## Install & run

```sh
cd tests
npm install
npm test
```

Useful variations:

```sh
# Point at a non-default Zen location (PowerShell)
$env:ZEN_BINARY = "D:\Apps\Zen\zen.exe"; npm test

# A single spec
npx playwright test specs/tidying.spec.ts

# Open the HTML report after a run
npm run report

# Type-check, lint, and format
npm run typecheck
npm run lint
npm run format
```

One Zen instance is launched per Playwright **worker** (the worker-scoped `zen`
fixture). Locally the default is `workers: 2` (two concurrent Zen windows); in CI
it drops to `1` automatically (the config keys off `process.env.CI`). Adjust the
local value in `playwright.config.ts` to match your machine.

## Manual inspection

To poke at a real, headed Zen with the script loaded — instead of running the
automated assertions — use:

```sh
npm run inspect
```

This launches Zen exactly like the tests do (injects `../index.uc.js`), seeds a
few tabs and a `Sample Group`, prints what to try, and then **leaves the window
open** so you can interact with it by hand. Press `Ctrl+C` in the terminal to
close it.

- By default the OpenRouter call is stubbed, so clicking 🧹 Tidy deterministically
  produces `Research` + `Reading` groups — no key or network needed.
- To exercise the **real** LLM flow, pass your OpenRouter key:

  ```sh
  # PowerShell
  $env:ZEN_TIDY_API_KEY = "sk-or-v1-..."; npm run inspect
  # bash
  ZEN_TIDY_API_KEY="sk-or-v1-..." npm run inspect
  ```

It uses its own `manual.config.ts` (with no timeout), so it never runs as part of
`npm test` or in CI.

## Continuous integration

Two GitHub Actions workflows live in `../.github/workflows/` and run on PRs to
`main` (only when relevant paths change, with superseded runs auto-cancelled):

- **`quality.yml`** — `npm run lint` (Biome) and `npm run typecheck` (`tsc`) on
  Ubuntu. Fast and browser-free.
- **`tests.yml`** — the full E2E suite on a `ubuntu-latest` / `windows-latest` /
  `macos-latest` matrix. Each job runs the suite headed (Linux under `xvfb`) and
  uploads the Playwright HTML report as a per-OS artifact.

To keep the matrix cheap, both the **Zen Browser** (keyed on the latest release
tag) and the **geckodriver** binary are cached between runs, so a normal run
downloads neither. The npm cache is handled by `actions/setup-node`. CI runs with
`workers: 1` automatically (the config keys off `process.env.CI`).

Both use Node 24 with `actions/checkout@v6` and `actions/setup-node@v6`.

## Notes

- The OpenRouter network call is **stubbed** (`installFetchStub`), so tidying is
  deterministic and free — no API key or network is used for the grouping itself.
  A dummy `zen-tidy-tabs.apikey` pref is pre-seeded so `runTidy()` reaches the stub.
- Real clicks are performed via WebDriver actions. If a chrome element refuses a
  native click (some XUL elements gate interactability), the helpers fall back to
  dispatching a genuine DOM event on the same element; each test annotation records
  which path was used (`native` vs `dispatched`).
- Chrome-context keyboard input isn't available for XUL/contenteditable elements,
  so the inline rename and modal Escape are driven via dispatched DOM events that
  match the script's own event handlers.
- Selectors mirror `index.uc.js` and live in `src/selectors.ts`. If the script
  renames an id/class, update that one file.
- Chrome context requires Zen to start with `-remote-allow-system-access`
  (set automatically by the launcher).
