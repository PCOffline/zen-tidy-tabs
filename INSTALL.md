# Installing Zen Tidy Tabs

Zen Tidy Tabs is a **userChrome.js script** (`index.uc.js`). Zen/Firefox cannot
run these on their own — they need a loader. The recommended loader is
[Sine](https://github.com/CosmoCreeper/Sine), a mod manager built for Zen.

> Heads up: this script runs with **full browser privileges**. Read the source
> before installing it, and only run versions you trust. Provided as-is, with no
> warranty or guarantees (see the disclaimer in `README.txt`).

## Method 1 — Sine, installed from a GitHub repo (recommended)

### 1. Install Sine

1. Download the installer for your OS from the
   [Sine releases page](https://github.com/CosmoCreeper/Sine/releases/latest).
2. Run the installer
3. Restart Zen.

You should now see a **Sine** section inside Zen's `Settings`.

### 2. Publish the script to a GitHub repo

Sine installs custom mods from a Git repository. Create a public repo containing
the script and a small `theme.json` describing it:

```
your-repo/
├── theme.json
└── index.uc.js
```

`theme.json`:

```json
{
  "name": "Zen Tidy Tabs",
  "description": "Arc-style AI tab tidying in Zen's native sidebar.",
  "scripts": {
    "index.uc.js": {
      "include": ["*browser.xhtml*"]
    }
  }
}
```

Notes:
- The key under `scripts` is the file path **relative to the repo root**.
- `include` is matched against the window URL; `*browser.xhtml*` limits the
  script to the main browser window. Omit `include` to run it in every chrome
  window (the script guards itself either way).
- `name`, `description`, `version`, and an `id` are auto-filled by Sine if you
  leave them out, but keeping `name`/`description` makes the entry readable.

### 3. Allow custom JavaScript

Sine only runs JavaScript from mods that came from its official
store unless you explicitly opt in. In `about:config`, set:

```
sine.allow-unsafe-js = true
```

### 4. Install the mod in Zen

1. Open Zen `Settings` → **Sine**.
2. In Sine's mod-install field, enter `https://github.com/PCOffline/zen-tidy-tabs`

### 5. Configure the API key

In `about:config`:

```
zen-tidy-tabs.apikey   (String) = sk-or-v1-...        (your OpenRouter key)
zen-tidy-tabs.model    (String) = openai/gpt-4o-mini  (optional, the model to use, defaults to gpt-4o-mini)
```

### 6. Apply

`about:support` → **Clear startup cache** → restart Zen. The hover-reveal
"🧹 Tidy" control should appear next to Zen's Clear button.

---

## Method 2 — Sine, fully local (no GitHub)

If you would rather not publish a repo, you can drop the mod into Sine's folder
by hand.

1. Open your profile folder: `about:support` → **Profile Folder** → *Open Folder*.
   On Windows this is typically
   `%APPDATA%\zen\Profiles\<your-profile>\`.
2. Go into `chrome\sine-mods\`.
3. Create a folder named `zen-tidy-tabs` and copy `index.uc.js` into it:
   `chrome\sine-mods\zen-tidy-tabs\index.uc.js`
4. Open `chrome\sine-mods\mods.json` and add an entry (merge it into the existing
   JSON object — keep any mods already listed):

   ```json
   {
     "zen-tidy-tabs": {
       "id": "zen-tidy-tabs",
       "name": "Zen Tidy Tabs",
       "description": "Arc-style AI tab tidying in Zen's native sidebar.",
       "enabled": true,
       "no-updates": true,
       "scripts": {
         "index.uc.js": {
           "include": ["*browser.xhtml*"]
         }
       }
     }
   }
   ```

   The top-level key and the `id` must both match the folder name (`zen-tidy-tabs`).
5. Enable custom JS as in Method 1, step 3: `sine.allow-unsafe-js = true`.
6. Set the API key prefs (Method 1, step 5).
7. `about:support` → **Clear startup cache** → restart.

To update: replace `index.uc.js`, clear the startup cache, and restart.
(`"no-updates": true` stops Sine from trying to update a mod that has no repo.)

---

## Sidenote — fx-autoconfig (loader-only alternative)

If you do not want Sine's mod manager and just want the script to load,
[fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig) is the classic
standalone userChrome.js loader. Unlike Sine's trimmed bootloader, it scans a
`JS` folder and runs every `.uc.js` it finds.

1. Download fx-autoconfig and follow its README.
2. Copy its `program/` files (e.g. `config.js`, `defaults/`) into Zen's
   **install** directory — the folder containing the Zen executable
   (on Windows, typically `C:\Program Files\Zen Browser\`).
3. Copy its `profile/chrome/` files into your profile's `chrome\` folder
   (`about:support` → *Profile Folder*). This creates `chrome\JS\`.
4. Put `index.uc.js` in `chrome\JS\`.
5. Set the API key prefs (Method 1, step 5).
6. `about:support` → **Clear startup cache** → restart.

With fx-autoconfig there is no `sine.allow-unsafe-js` gate and no `theme.json` —
the `// @include main` header in the script is honored directly. There is also
no auto-update; to ship a new version, replace the file in `chrome\JS\`, clear
the startup cache, and restart.

---

## Quick temporary test (no loader)

For one-off testing without installing anything:

1. `about:config`: `devtools.chrome.enabled = true`.
2. Open the **Browser Console** (Ctrl+Shift+J) — not the web console (F12).
3. Paste the full contents of `index.uc.js` and press Enter.

This is wiped on restart.
