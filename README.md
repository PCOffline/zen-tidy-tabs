# Zen Tidy Tabs

[![Tests](https://github.com/PCOffline/zen-tidy-tabs/actions/workflows/tests.yml/badge.svg)](https://github.com/PCOffline/zen-tidy-tabs/actions/workflows/tests.yml)
[![Quality](https://github.com/PCOffline/zen-tidy-tabs/actions/workflows/quality.yml/badge.svg)](https://github.com/PCOffline/zen-tidy-tabs/actions/workflows/quality.yml)
[![Zen Browser](https://img.shields.io/badge/Zen%20Browser-1.20.x-f76f53)](https://zen-browser.app/)
[![Firefox core](https://img.shields.io/badge/Firefox%20core-151-ff7139?logo=firefox-browser&logoColor=white)](https://www.mozilla.org/firefox/)

Arc-style, AI-powered tab tidying built into [Zen Browser](https://zen-browser.app/)'s
native sidebar. Organise your tabs by categories in the press of a button.

> [!WARNING]
> **This is a userChrome.js userscript, not a regular browser extension.**
> It runs as privileged browser code with **full access to your browser** — your
> tabs, your data, and everything the browser itself can do. It is **provided
> as-is, with no warranties or guarantees of any kind**. Read the source before
> installing, only run versions you trust, and use it entirely at your own risk.

## Features

- **One-click tidy** — adds a hover-reveal "🧹 Tidy" control next to Zen's Clear
  button. Click it to cluster the open tabs in the active workspace.
- **Native Zen tab groups** — clusters become real Zen groups, so you get labeled
  headers, collapse, close-group, and drag-and-drop between groups for free.
- **Smart re-tidy** — running it again reconsiders the *whole* workspace (already
  grouped tabs included), so new tabs join existing categories or the layout is
  reorganized. Emptied groups dissolve automatically.
- **Rename & recolor** — left-click a group label to rename it inline; right-click
  it for more group options like renaming and recoloring.
- **Privacy-aware** — query strings are never sent to the model, and you choose how
  much of each tab is shared (title only, title + domain, or title + URL).

## Requirements

- [Zen Browser](https://zen-browser.app/) (developed against Zen 1.20.x / Firefox
  151 core).
- A userChrome.js loader — [Sine](https://github.com/CosmoCreeper/Sine)
  (recommended) or [fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig).
- An [OpenRouter](https://openrouter.ai/) API key.

## Installation

See **[INSTALL.md](./docs/INSTALL.md)** for the full, step-by-step walkthrough (Sine
from a GitHub repo, Sine fully local, or fx-autoconfig). In short:

1. Install a userChrome.js loader (Sine recommended).
2. Register the script with that loader.
3. Set your OpenRouter API key (see [Configuration](#configuration) — or use the
   in-app settings).
4. Open `about:support` → **Clear startup cache** → restart Zen.

Once loaded, the "🧹 Tidy" control appears next to Zen's Clear button.

## Usage

- **Tidy:** click the "🧹 Tidy" control. Tabs in the active workspace are clustered
  into native groups. (At least 3 tabs are required.)
- **Settings:** right-click the "🧹 Tidy" control to open the settings modal, where
  you can set your API key, model, and other options.
- **Rename a group:** left-click its label to rename it inline, or right-click it
  for more group options (rename, recolor, and more).

## Configuration

Everything can be set from the in-app settings modal (right-click the Tidy
control). The same options are also exposed as `about:config` preferences:

| Preference | Type | Values | Description |
|---|---|---|---|
| `zen-tidy-tabs.apikey` | String | `sk-or-v1-...` | Your OpenRouter API key. |
| `zen-tidy-tabs.model` | String | model slug | Model to use. Defaults to `openai/gpt-4o-mini`. |
| `zen-tidy-tabs.urlmode` | String | `detailed` \| `compact` \| `minimal` | How much of each tab is sent to the model. `detailed` = title + URL, `compact` = title + domain, `minimal` = title only. Default: `detailed`. Query strings are never sent. |
| `zen-tidy-tabs.labelstyle` | String | `filled` \| `text` | Visual style of group labels. |

**Choosing a model:** avoid `openrouter/free` and reasoning-style models — they
often return empty content. Use a concrete instruct model. Good options include
`openai/gpt-4o-mini`, `openai/gpt-4.1-mini`, `google/gemini-flash-1.5`, and
`anthropic/claude-3.5-haiku`.

> [!WARNING]
> Your API key is stored locally in plaintext in your profile's `prefs.js`. It is recommended this key has a sane usage limit, in case of a leak.

## Development & debugging

For a quick, no-install trial (wiped on restart):

1. In `about:config`, set `devtools.chrome.enabled = true`.
2. Open the **Browser Console** with `Ctrl+Shift+J` (not the web console / `F12`).
3. Paste the full contents of `index.uc.js` and press Enter.

Manual controls are exposed on `window.zenTidyTabs` for use from the Browser
Console:

| Call | Action |
|---|---|
| `zenTidyTabs.run()` | Run a tidy now. |
| `zenTidyTabs.settings()` | Open the settings modal. |
| `zenTidyTabs.mount()` | (Re)place the Tidy control. |
| `zenTidyTabs.injectStyles()` | (Re)inject the stylesheet. |
| `zenTidyTabs.diagnose()` | Print a capability/diagnostic summary. |
| `zenTidyTabs.collect()` | Inspect the collected tab snapshot. |

## Contributing

Issues and pull requests are welcome at
[PCOffline/zen-tidy-tabs](https://github.com/PCOffline/zen-tidy-tabs). When
reporting a bug, please include your Zen version, the model you're using, and any
relevant output from the Browser Console (lines are prefixed with
`[Zen Tidy Tabs]`).

## Disclaimer

This software is provided "as is", without warranty of any kind, express or
implied. As privileged browser code it can do anything the browser can. The author
is not responsible for any data loss, damage, or other consequences arising from
its use. Review the source and proceed at your own risk.
