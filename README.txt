Zen Tidy — Arc-style AI tab tidying in Zen's NATIVE sidebar
Target: Zen 1.20.x (Firefox 151 core)

WHAT IT DOES
- Adds a hover-reveal "🧹 Tidy" control next to Zen's Clear button.
- Click it: the open tabs in the active workspace are sent to an LLM (via
  OpenRouter), which clusters them; native Zen tab groups are then created.
- Re-tidy reconsiders the WHOLE workspace (grouped tabs included), so new tabs
  join existing categories or the layout is reorganized. Emptied groups dissolve.
- Double-click a group label to rename + recolor it.
- Native groups give labeled headers, collapse, close-group, and drag-and-drop
  between groups for free.

CODE LAYOUT (JS/zen-tidy.uc.js)
  CONFIG ........ all tweakables (prefs, model, label, colors)
  env ........... resolves the chrome window that owns gBrowser
  dom ........... every selector strategy, documented in one place
  prefs ......... read about:config values
  tabs .......... collect / snapshot / liveness
  ai ............ prompt, request, response extraction, parsing
  groups ........ create native groups, cleanup empties
  control ....... the Tidy button (twin of Clear)
  editor ........ double-click rename/recolor
  styles ........ button-only CSS (groups stay native)
  orchestrator .. runTidy() pipeline + notifications
  init .......... mount + poll + manual controls

SETUP
1. Install a userChrome.js loader (fx-autoconfig or Sine).
2. Put JS/zen-tidy.uc.js in <profile>/chrome/JS/.
3. about:config:
   extensions.zentidy.apikey  (String) = sk-or-v1-...   (OpenRouter key)
   extensions.zentidy.model   (String) = openai/gpt-4o-mini   (optional)
4. about:support → Clear startup cache → restart.

QUICK TEST (temporary, no loader)
- about:config: devtools.chrome.enabled = true
- Browser Console (Ctrl+Shift+J) → paste the whole script.
- Manual controls: zenTidy.run(), zenTidy.mount(), zenTidy.injectStyles()

NOTES
- Avoid 'openrouter/free' / reasoning models — they often return empty content.
  Use a concrete instruct model like openai/gpt-4o-mini.
- API key is stored in plaintext in prefs.js (local only).
- Chrome scripts are fully privileged — read the source before running.
