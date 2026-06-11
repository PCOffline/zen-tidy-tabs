# Zen Tidy Tabs — end-to-end tests

These tests drive a **real Zen browser** and exercise the `index.js` userChrome
script the way a user would: clicking the Tidy control, right-clicking it,
renaming group badges, and tidying tabs.

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
| `specs/tidy-button.spec.js` | The Tidy button exists; its placement (twin of Clear, or the documented fallback) is correct |
| `specs/settings.spec.js` | Right-clicking the button opens the Zen Tidy Tabs configuration modal |
| `specs/tidying.spec.js` | Tidying actually works (the OpenRouter call is stubbed; tabs are sorted into native groups) |
| `specs/group-badge.spec.js` | Single-click renames a badge inline; double-click opens the rename + recolor modal |

The script under test is read straight from `../index.js` and injected into the
chrome window, so the tests always run against the current source.

## Requirements

- **Zen Browser** installed. Default path is `C:\Program Files\Zen Browser\zen.exe`;
  override with the `ZEN_BINARY` env var.
- **Node.js** (18+).
- Internet access on first run: Selenium Manager downloads a matching geckodriver
  automatically.
- Run with a desktop session (headed). Headless Firefox exposes the chrome DOM but
  reports elements as not-displayed, which breaks real clicks. You can set
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
npx playwright test specs/tidying.spec.js

# Open the HTML report after a run
npm run report
```

## Notes

- The OpenRouter network call is **stubbed** (`installFetchStub`), so tidying is
  deterministic and free — no API key or network is used for the grouping itself.
  A dummy `zentidy.apikey` pref is pre-seeded so `runTidy()` reaches the stub.
- Real clicks are performed via WebDriver actions. If a chrome element refuses a
  native click (some XUL elements gate interactability), the helpers fall back to
  dispatching a genuine DOM event on the same element; each test annotation records
  which path was used.
- Selectors mirror `index.js` and live in `src/selectors.js`. If the script renames
  an id/class, update that one file.
