# Running the tests

Zen Tidy Tabs ships an end-to-end test suite that drives a real Zen browser
through [Playwright](https://playwright.dev/)'s runner and a Selenium WebDriver
(`geckodriver`) connection in Zen's privileged **chrome** context. The tests
verify the clauses in [`SPEC.md`](./SPEC.md) — see the `Verified by:` line on each
clause.

All commands below are run from the **repository root** (the npm scripts `cd`
into `tests/` internally).

## Prerequisites

- **Node.js ≥ 24** (see `engines` in `package.json`).
- A local **Zen Browser** install (the suite launches the real browser).
- Install dependencies once:

  ```sh
  npm ci
  ```

`geckodriver` is provisioned automatically: the harness downloads it on first run
into a project-local cache (`tests/.geckodriver`) and reuses it thereafter. No
global install is needed.

## npm scripts

| Script | What it does |
|---|---|
| `npm test` | Run the suite **headless** (`ZEN_HEADLESS=1`). |
| `npm run test:headful` | Run the suite **headed** (a visible Zen window). This is what CI runs; some specs that need real pointer/keyboard input only assert fully when headed. |
| `npm run inspect` | Launch a headed Zen with the script injected and some sample tabs/groups, then keep it open for manual poking (`tests/manual/`). |
| `npm run report` | Open the last Playwright HTML report. |
| `npm run typecheck` | Type-check the test sources (`tsc --noEmit`). |
| `npm run lint` | Lint/format-check the test sources with Biome. |
| `npm run lint:script` | Lint/format-check the product file `index.uc.js`. |
| `npm run format` / `npm run format:script` | Auto-format the tests / `index.uc.js`. |

Run a single spec or test by passing Playwright args, e.g.:

```sh
cd tests && npx playwright test specs/tidy-run.spec.ts
cd tests && npx playwright test -g "notifies success"
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ZEN_BINARY` | `C:\Program Files\Zen Browser\zen.exe` | Absolute path to the Zen executable. **Set this** if Zen is installed elsewhere (e.g. on Linux/macOS, or a non-default Windows location). |
| `ZEN_HEADLESS` | unset | `1` runs Zen headless. `npm test` sets it; `npm run test:headful` leaves it unset. |
| `GECKODRIVER_PATH` | unset | Absolute path to an existing `geckodriver` binary, to skip the automatic download. |
| `ZEN_TIDY_API_KEY` | unset | A real OpenRouter key for the **manual** `npm run inspect` session, to exercise the live LLM flow. The automated specs **don't** need it — they stub the network and pre-seed a dummy key. |
| `CI` | unset | Set by CI. The Playwright config reads it to pin workers to 1, forbid `test.only`, and enable retries. |

The OpenRouter network call is **stubbed** in every automated spec, so the suite
is deterministic and offline — you don't need a real API key to run it.

## How the browser is provisioned

- **Locally:** install Zen yourself and point `ZEN_BINARY` at it (or rely on the
  default Windows path). `geckodriver` is downloaded automatically on first run.
- **In CI** (`.github/workflows/tests.yml`): the workflow runs the matrix on
  Ubuntu, Windows, and macOS with Node 24, downloads the latest Zen release into a
  cached `.zen-browser/` directory, exports `ZEN_BINARY`, caches
  `tests/.geckodriver`, and runs `npm run test:headful` (Linux runs headed under
  `xvfb`).
