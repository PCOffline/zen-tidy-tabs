# Installing Zen Tidy Tabs

Zen Tidy Tabs is a **userChrome.js script** (`index.uc.js`). Zen/Firefox cannot
run these on their own — they need a loader. The recommended loader is
[Sine](https://github.com/CosmoCreeper/Sine), a mod manager built for Zen.

> Heads up: this script runs with **full browser privileges**. Read the source
> before installing it, and only run versions you trust. Provided as-is, with no
> warranty or guarantees (see the disclaimer in `README.txt`).

You will need an [OpenRouter](https://openrouter.ai/keys) API key to use the
AI tidying. Keep it handy — you will enter it once everything is installed (see
[Configuring your API key](#configuring-your-api-key)).

## Install with Sine (recommended)

1. Follow [Sine's installation instructions](https://github.com/CosmoCreeper/Sine#%EF%B8%8F-installation).
2. Open Zen `Settings` → **Sine Mods**.
3. Next to "or, add your own locally from a GitHub repo", click the cogwheel and
   toggle **Enable installing JS from unofficial sources**.
4. Add the mod, either:
   - **From GitHub:** in the input field, enter `PCOffline/zen-tidy-tabs` and
     click **Install**.
   - **From a local folder:** click **Import** and select your local
     `zen-tidy-tabs` folder (the one containing `index.uc.js`). Download/clone
     this project first so you have it.
5. Open `about:support` → **Clear startup cache** → restart Zen. The hover-reveal
   "🧹 Tidy" control should appear next to Zen's Clear button.
6. Follow [Configuring your API key](#configuring-your-api-key) below.

To update a locally-imported mod, re-import the updated folder, clear the startup
cache, and restart.

---

## Configuring your API key

You need an OpenRouter API key (`sk-or-v1-...`) before Zen Tidy Tabs can do
anything. Grab one for free at [openrouter.ai/keys](https://openrouter.ai/keys).

Set it through the Tidy settings modal:

1. Find the "🧹 Tidy" control next to Zen's Clear button (hover the area if it is
   hidden).
2. **Right-click** it to open **Zen Tidy Tabs Settings**.
3. Paste your key into the **OpenRouter API key** field.
4. *(Optional)* Set a **Model** — leave it blank to use the default
   (`openai/gpt-4o-mini`).
5. Click **Save settings**.

Your key is stored locally on your machine. You can reopen this modal any time to
change the key, switch models, or adjust the other appearance options.

---

## Sidenote — fx-autoconfig (loader-only alternative)

If you do not want Sine's mod manager and just want the script to load, you may use
[fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig).

1. Download fx-autoconfig and follow its README.
2. Copy its `program/` files (e.g. `config.js`, `defaults/`) into Zen's
   **install** directory — the folder containing the Zen executable
   (on Windows, typically `C:\Program Files\Zen Browser\`).
3. Copy its `profile/chrome/` files into your profile's `chrome\` folder
   (`about:support` → *Profile Folder*). This creates `chrome\JS\`.
4. Put `index.uc.js` in `chrome\JS\`.
5. Open `about:support` → **Clear startup cache** → restart Zen.
6. Configure your API key — see [Configuring your API key](#configuring-your-api-key).

With fx-autoconfig, there is **no auto-update**; to ship a new version, replace the file in `chrome\JS\`, clear
the startup cache, and restart.

---

## Quick temporary test (no loader)

For one-off testing without installing anything:

1. In `about:config`, set the `devtools.chrome.enabled` preference to `true`.
2. Open the **Browser Console** (Ctrl+Shift+J) — not the web console (F12).
3. Paste the full contents of `index.uc.js` and press Enter.

This is wiped on restart.
