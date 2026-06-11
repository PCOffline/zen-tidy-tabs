// ==UserScript==
// @name           Zen Tidy Tabs
// @description    Arc-style AI tab tidying integrated into Zen's native sidebar.
//                 A hover-reveal "Tidy" control clusters the open tabs via an
//                 LLM (OpenRouter) into native Zen tab groups. Double-click a
//                 group label to rename / recolor it.
// @author         PCOffline
// @include        main
// ==/UserScript==

(() => {
  "use strict";

  // ============================================================================
  // Configuration — every tweakable value lives here.
  // ============================================================================
  const CONFIG = {
    debug: false,

    // Preference keys (Services.prefs / about:config).
    prefs: {
      apiKey: "zen-tidy-tabs.apikey",          // OpenRouter key (sk-or-v1-...)
      model: "zen-tidy-tabs.model",            // optional model slug override
      labelStyle: "zen-tidy-tabs.labelstyle",  // "filled" | "text"
      urlMode: "zen-tidy-tabs.urlmode",        // "detailed" | "compact" | "minimal"
    },

    api: {
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      defaultModel: "openai/gpt-4o-mini",
      maxTokens: 2048,                 // floor; scaled up with tab count
      maxTokensCeiling: 8192,
      tokensPerTab: 24,                // max_tokens grows by this per tab...
      tokensBuffer: 256,               // ...plus this fixed buffer
      temperature: 0.2,                // low → stable, repeatable clustering
      seed: 7,
      timeoutMs: 90000,                // abort a hung request
      errorBodyMaxChars: 300,          // truncate HTTP error bodies in logs
      outputPreviewMaxChars: 200,      // truncate unparseable model output in logs
      referer: "https://github.com/PCOffline/zen-tidy-tabs", // OpenRouter attribution
      title: "Zen Tidy Tabs",
      suggestedModels: [
        "openai/gpt-4o-mini",
        "openai/gpt-4.1-mini",
        "google/gemini-flash-1.5",
        "anthropic/claude-3.5-haiku",
      ],
    },

    ui: {
      controlId: "zen-tidy-tabs-button",
      styleId: "zen-tidy-tabs-style",
      label: "🧹 Tidy",
      busyLabel: "↻ Tidying…",
      // Display approximations of the 9 native group colors (Firefox tab groups
      // only accept these named colors).
      swatchHex: {
        blue: "#4983f0",
        red: "#d8453b",
        yellow: "#e8c14a",
        green: "#54b75e",
        pink: "#e667af",
        purple: "#8a67e8",
        cyan: "#3fbcd4",
        orange: "#e3893c",
        gray: "#8a8a96",
      },
    },

    grouping: {
      colors: ["blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange", "gray"],
      minTabs: 3,              // refuse to tidy fewer than this
      minGroups: 2,            // lower bound for the model's group cap
      maxGroups: 8,            // upper bound for the model's group cap
      targetTabsPerGroup: 3,   // group cap scales as ceil(tabCount / this)
    },

    snapshot: {
      titleMax: 160,  // truncate long titles before sending to the model
      urlMax: 120,    // truncate long URLs too
    },

    // Timing constants in ms (counts where noted) for debounces, polling, retries.
    timing: {
      doubleClickMs: 300,            // single- vs double-click disambiguation window
      emptyCheckDelayMs: 80,         // delay before the first empty-group sweep
      emptyCheckIntervalMs: 150,     // interval between empty-group sweeps
      emptyCheckMaxTries: 6,         // number of empty-group sweeps per schedule
      emptyWatcherDebounceMs: 500,   // debounce for the drag-driven empty watcher
      notifyDurationMs: 6000,        // how long a notification stays up
      mountRetryMs: 250,             // interval between mount attempts
      mountMaxAttempts: 40,          // give up mounting after this many attempts
    },
  };

  // ============================================================================
  // Logging — one scoped logger per stage. Every line is tagged
  // "[Zen Tidy Tabs] [<stage>]"; .debug output is silenced unless CONFIG.debug.
  // ============================================================================
  const PREFIX = "[Zen Tidy Tabs]";
  const makeLogger = (stage) => {
    const tag = `${PREFIX} [${stage}]`;
    return {
      info: (...args) => console.info(tag, ...args),
      warn: (...args) => console.warn(tag, ...args),
      error: (...args) => console.error(tag, ...args),
      debug: (...args) => { if (CONFIG.debug) console.debug(tag, ...args); },
    };
  };
  const Log = {
    init: makeLogger("Initialization"),
    config: makeLogger("Config"),
    dom: makeLogger("DOM"),
    styles: makeLogger("Styles"),
    ai: makeLogger("AI"),
    groups: makeLogger("Groups"),
    tidy: makeLogger("Tidy"),
    user: makeLogger("User Interaction"),
    diagnose: makeLogger("Diagnostics"),
  };

  // ============================================================================
  // Environment — resolve the chrome window that owns gBrowser. Prefer the
  // script's own `window`; fall back to the most-recent browser window (e.g.
  // when pasted into the Browser Console, where `window` lacks gBrowser).
  // ============================================================================
  const env = (() => {
    let browserWindow = typeof window !== "undefined" ? window : null;
    if (!browserWindow?.gBrowser) {
      try {
        const mostRecent = Services.wm.getMostRecentWindow("navigator:browser");
        if (mostRecent?.gBrowser) browserWindow = mostRecent;
      } catch (e) {
        Log.init.error("Could not resolve a browser window via Services.wm; gBrowser is unavailable.", e);
      }
    }
    return browserWindow?.gBrowser
      ? { win: browserWindow, doc: browserWindow.document, gBrowser: browserWindow.gBrowser }
      : null;
  })();

  if (!env) {
    Log.init.error(
      "Startup aborted: no window with gBrowser was found. Run this in the " +
      "Browser Console (Ctrl+Shift+J) with devtools.chrome.enabled = true — " +
      "the page web console (F12) cannot access the browser chrome."
    );
    return;
  }

  const { win, doc, gBrowser } = env;

  // ============================================================================
  // Native <tab-group> helpers — one place for reading and writing a group's
  // name, color and tabs. The label may live on a property or an attribute, and
  // the tabs may live on `.tabs` or only be queryable.
  // ============================================================================
  const TAB_SELECTOR = "tab, .tabbrowser-tab";
  const normalizeName = (name) => (name || "").trim().toLowerCase();
  const getGroupName = (el) => (el?.label || el?.getAttribute?.("label") || "").trim();
  const getGroupColor = (el) => el?.color || el?.getAttribute?.("color") || "";
  const getGroupTabs = (el) => el.tabs || el.querySelectorAll(TAB_SELECTOR);
  const setGroupName = (el, name) => { el.label = name; el.setAttribute("label", name); };
  const setGroupColor = (el, color) => { el.color = color; el.setAttribute("color", color); };

  // ============================================================================
  // DOM access — every selector strategy is isolated here, so there is exactly
  // one place to update when Zen changes its internals.
  // ============================================================================
  const dom = {
    // The active workspace's tab section. Zen keeps one section per workspace in
    // the DOM; the selected tab lives in the active one, so climb from it.
    activeSection() {
      return (
        gBrowser.selectedTab?.closest?.(".zen-workspace-tabs-section") ||
        doc.querySelector(".zen-workspace-tabs-section[active]") ||
        doc.querySelector(".zen-workspace-tabs-section")
      );
    },

    // Zen's native "Clear" control. It has no stable id/class and may render its
    // text via a `label` attribute or a CSS pseudo-element, so check all three.
    clearControl() {
      const scopes = [doc.getElementById("tabbrowser-tabs"), dom.activeSection(), doc].filter(Boolean);
      const seen = new Set();
      const selector = "toolbarbutton, button, label, span, hbox, vbox, toolbaritem, [label], [tooltiptext]";

      for (const scope of scopes) {
        for (const el of scope.querySelectorAll(selector)) {
          if (seen.has(el)) continue;
          seen.add(el);

          if ((el.getAttribute?.("label") || "").trim().toLowerCase() === "clear") return el;
          if ((el.textContent || "").trim().toLowerCase() === "clear") return el;

          if (!el.children.length) {
            try {
              for (const pseudo of ["::before", "::after"]) {
                if (/clear/i.test(win.getComputedStyle(el, pseudo).content || "")) return el;
              }
            } catch { /* detached node */ }
          }
        }
      }
      return null;
    },

    // First normal (non-pinned, non-essential) tab or group in a section. Used
    // as a fallback mount anchor when there's no Clear control to sit beside.
    firstNormalNode(section) {
      for (const el of section.querySelectorAll("tab-group, tab, .tabbrowser-tab")) {
        if (dom.isGroupEl(el)) return el;
        if (!(el.pinned || el.hasAttribute?.("zen-essential"))) return el;
      }
      return null;
    },

    isGroupEl(el) {
      return (el?.tagName || "").toLowerCase() === "tab-group" || el?.classList?.contains?.("tab-group");
    },

    describe(el) {
      if (!el) return "null";
      return (el.tagName || "?").toLowerCase() +
        (el.id ? "#" + el.id : "") +
        (el.className ? "." + String(el.className).trim().split(/\s+/)[0] : "");
    },
  };

  // ============================================================================
  // Preferences
  // ============================================================================
  const prefs = {
    get(name, fallback = "") {
      try { return Services.prefs.getStringPref(name, fallback); } catch { return fallback; }
    },
    set(name, value) {
      try {
        Services.prefs.setStringPref(name, value ?? "");
        Log.config.debug(`Saved preference "${name}".`);
      } catch (e) {
        Log.config.error(`Failed to save preference "${name}".`, e);
      }
    },
    apiKey() { return prefs.get(CONFIG.prefs.apiKey); },
    model() { return prefs.get(CONFIG.prefs.model, CONFIG.api.defaultModel); },
    labelStyle() { return prefs.get(CONFIG.prefs.labelStyle, "filled"); },
    urlMode() {
      const mode = prefs.get(CONFIG.prefs.urlMode, "detailed");
      return ["detailed", "compact", "minimal"].includes(mode) ? mode : "detailed";
    },
  };

  // ============================================================================
  // Tabs
  // ============================================================================
  const tabs = {
    // Eligible tabs in the active workspace. includeGrouped=false → ungrouped
    // only (status readouts); true → every eligible tab, so a re-tidy can move
    // tabs between groups.
    collect(includeGrouped) {
      const workspaceId = win.gZenWorkspaces?.activeWorkspace ?? null;
      return gBrowser.tabs.filter((tab) => {
        if (tab.pinned || tab.hidden || tab.closing) return false;
        if (!includeGrouped && tab.group) return false;
        if (tab.hasAttribute("zen-empty-tab") || tab.hasAttribute("zen-glance-tab")) return false;
        const tabWorkspace = tab.getAttribute("zen-workspace-id");
        if (workspaceId && tabWorkspace && tabWorkspace !== workspaceId) return false;
        return true;
      });
    },

    // A tab is usable only if it wasn't closed during the async API call.
    isAlive(tab) {
      return tab && !tab.closing && tab.isConnected && gBrowser.tabs.includes(tab);
    },

    title(tab) { return (tab.label || "").slice(0, CONFIG.snapshot.titleMax); },

    // The URL string sent for a tab, per the user's privacy preference. Query
    // and hash are always stripped:
    //   detailed → domain + path (default)   compact → hostname   minimal → none
    formatUrl(spec, mode) {
      if (!spec || mode === "minimal") return "";
      if (mode === "compact") {
        try { return new win.URL(spec).hostname; } catch { return ""; }
      }
      return spec.split("?")[0].split("#")[0].slice(0, CONFIG.snapshot.urlMax);
    },

    // Compact [{i, title, url?, group?}] list for the model. `group` is included
    // only for already-grouped tabs, so a re-tidy can keep stable groupings.
    snapshot(list) {
      const mode = prefs.urlMode();
      return list.map((tab, i) => {
        const entry = { i, title: tabs.title(tab) };
        const url = tabs.formatUrl(tab.linkedBrowser?.currentURI?.spec || "", mode);
        if (url) entry.url = url;
        const group = getGroupName(tab.group);
        if (group) entry.group = group;
        return entry;
      });
    },
  };

  // ============================================================================
  // AI categorization
  // ============================================================================
  const ai = {
    // The prompt encodes what a good grouping is, a naming rubric, hard
    // constraints, an output contract, and worked examples — so even small,
    // cheap models produce consistent, clean JSON.
    buildPrompt(snapshot) {
      const tabCount = snapshot.length;
      const lastIndex = tabCount - 1;
      const maxGroups = Math.min(
        CONFIG.grouping.maxGroups,
        Math.max(CONFIG.grouping.minGroups, Math.ceil(tabCount / CONFIG.grouping.targetTabsPerGroup))
      );
      const hasGroups = snapshot.some((tab) => tab.group);
      return [
        `You are "Tidy", an engine that organizes a browser sidebar's open tabs`,
        `into a small set of clean, intuitive groups — like Arc's "Tidy Tabs".`,
        ``,
        `## Input`,
        `${tabCount} tabs. Each object has {"i": <index 0-${lastIndex}>, "title": <string>}`,
        `and may also include "url": <string> and "group": <string> (the name of`,
        `the group the tab is CURRENTLY in). Treat "group" as a strong hint, not a`,
        `command. Use whatever fields are present; the title is always the primary signal.`,
        ``,
        `<tabs>`,
        JSON.stringify(snapshot),
        `</tabs>`,
        ``,
        `## What a good grouping looks like`,
        `- Group by what the user is DOING — a project, topic, game, or task —`,
        `  not merely by website. Tabs from different domains often belong`,
        `  together (a wiki page, a YouTube video, and a store page about the`,
        `  same game are one group).`,
        `- Be specific when a cluster is clearly about one thing: prefer`,
        `  "Wynncraft" over "Gaming", "ADHD Notes" over "Articles".`,
        `- Keep granularity consistent: groups of roughly comparable size.`,
        `  Avoid one giant catch-all sitting next to several singletons.`,
        `- Merge near-duplicates (the same product, repeated searches) together.`,
        hasGroups
          ? `- STABILITY: many tabs already have a "group" name. When a tab's current\n  group still makes sense, KEEP it there and reuse that exact name — do not\n  rename or reshuffle a sensible group just to change it. Prefer adding new\n  tabs into a fitting existing group over inventing a parallel one.\n- REORGANIZE only with a clear reason: e.g. new tabs make a BROADER category\n  sensible (an existing "Cooking" group plus new chicken-care tabs becomes\n  "Chicken"), or the current split is clearly wrong. A broader, more accurate\n  category is worth moving older tabs for; cosmetic churn is not.`
          : ``,
        ``,
        `## Grounding (critical)`,
        `- Use ONLY the titles and URLs given. Never invent a theme that the`,
        `  tabs do not clearly support. If no tab is about sports, there is no`,
        `  "Sports" group. Every group must be justified by its members.`,
        ``,
        `## Avoid`,
        `- A vague mega-group holding most tabs.`,
        `- Many one-tab groups when those tabs share an obvious theme.`,
        `- Two different groups that mean the same thing.`,
        ``,
        `## Naming`,
        `- 1-3 words, Title Case, human-readable. No emojis, no quotes.`,
        `- Name the shared theme, not a list of the items.`,
        `- NEVER use "Misc", "Other", "Various", "General", "Web", or "Stuff".`,
        `  If a tab seems unrelated, give it the most specific name you can or`,
        `  fold it into the closest genuinely-related group.`,
        ``,
        `## Hard constraints (must all hold)`,
        `1. Produce between 1 and ${maxGroups} groups (1 is fine if every tab shares one theme).`,
        `2. Every index 0-${lastIndex} appears in EXACTLY ONE group.`,
        `   Never skip an index, never repeat one, never invent one out of range.`,
        `3. Output ONLY a single JSON object matching the schema — no prose,`,
        `   no markdown, no code fences.`,
        ``,
        `## Output schema`,
        `{"groups":[{"name":"<Title Case label>","tabs":[<indices>]}]}`,
        ``,
        `## Examples`,
        `Input: [{"i":0,"title":"Horses - Wynncraft Wiki","url":"wiki.wynncraft.com/horses"},{"i":1,"title":"Wynncraft Market","url":"trade.wynncraft.com"},{"i":2,"title":"Best Beef Chili Recipe","url":"allrecipes.com/chili"},{"i":3,"title":"Van Gogh Mouse Pad - AliExpress","url":"aliexpress.com/x"},{"i":4,"title":"Monet Mouse Pad - AliExpress","url":"aliexpress.com/y"}]`,
        `Output: {"groups":[{"name":"Wynncraft","tabs":[0,1]},{"name":"Mouse Pad Shopping","tabs":[3,4]},{"name":"Recipes","tabs":[2]}]}`,
        ``,
        `Input (all one theme): [{"i":0,"title":"React useEffect docs","url":"react.dev"},{"i":1,"title":"React Router tutorial","url":"reactrouter.com"},{"i":2,"title":"Why my React app re-renders","url":"stackoverflow.com"}]`,
        `Output: {"groups":[{"name":"React","tabs":[0,1,2]}]}`,
        ``,
        `Now output only the JSON object.`,
      ].filter((line) => line !== "").join("\n");
    },

    async request(snapshot, apiKey, model) {
      const maxTokens = Math.min(
        CONFIG.api.maxTokensCeiling,
        Math.max(CONFIG.api.maxTokens, snapshot.length * CONFIG.api.tokensPerTab + CONFIG.api.tokensBuffer)
      );
      const body = {
        model,
        temperature: CONFIG.api.temperature,
        seed: CONFIG.api.seed,
        max_tokens: maxTokens,
        // Ask the provider to guarantee a JSON object; we degrade gracefully if
        // a model rejects it (see the retry below).
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a precise tab-organizing engine. You reply with a single " +
              "valid JSON object and nothing else: no markdown, no code fences, " +
              "no commentary, no text before or after the JSON. Even when " +
              "uncertain, you still return only valid JSON in the requested schema.",
          },
          { role: "user", content: ai.buildPrompt(snapshot) },
        ],
      };

      try {
        return await ai.post(body, apiKey);
      } catch (e) {
        // Some models/providers reject response_format. Retry once without it.
        if (e?.status === 400 && /response_format|json/i.test(e.message || "")) {
          Log.ai.warn(`Model "${body.model}" rejected response_format=json_object (HTTP 400); retrying once without it.`);
          delete body.response_format;
          return await ai.post(body, apiKey);
        }
        throw e;
      }
    },

    // POST to OpenRouter with a hard timeout so a hung request can never lock
    // the Tidy button indefinitely.
    async post(body, apiKey) {
      Log.ai.debug(`Requesting completion from OpenRouter (model: ${body.model}, max_tokens: ${body.max_tokens}, timeout: ${CONFIG.api.timeoutMs}ms).`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CONFIG.api.timeoutMs);

      let response;
      try {
        response = await fetch(CONFIG.api.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + apiKey,
            "HTTP-Referer": CONFIG.api.referer,
            "X-Title": CONFIG.api.title,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (e) {
        if (e?.name === "AbortError") {
          Log.ai.error(`OpenRouter request aborted after exceeding the ${CONFIG.api.timeoutMs / 1000}s timeout (model: ${body.model}).`);
          throw new Error(`OpenRouter request timed out after ${CONFIG.api.timeoutMs / 1000}s`);
        }
        Log.ai.error(`Network error while contacting OpenRouter (endpoint: ${CONFIG.api.endpoint}).`, e);
        throw e;
      } finally {
        clearTimeout(timer);
      }

      Log.ai.debug(`OpenRouter responded with HTTP ${response.status}${response.statusText ? " " + response.statusText : ""}.`);
      if (!response.ok) {
        const detail = (await response.text()).slice(0, CONFIG.api.errorBodyMaxChars);
        Log.ai.error(`OpenRouter request failed with HTTP ${response.status}. Response body (truncated): ${detail}`);
        const error = new Error(`OpenRouter ${response.status}: ${detail}`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    },

    // Pull the assistant text out of an OpenRouter/OpenAI response, tolerating
    // array-style content and reasoning-only replies.
    extractText(data) {
      if (data.error) {
        const detail = data.error.message || JSON.stringify(data.error);
        Log.ai.error("OpenRouter returned an error payload:", detail);
        throw new Error("API error: " + detail);
      }

      const message = data.choices?.[0]?.message;
      let content = message?.content;
      if (Array.isArray(content)) {
        content = content.map((part) => part?.text || part?.content || "").join("");
      }
      content = (content || "").trim();
      if (!content && message?.reasoning) content = String(message.reasoning).trim();

      if (!content) {
        Log.ai.error(
          "Model returned an empty completion.",
          "finish_reason:", data.choices?.[0]?.finish_reason,
          "| model:", data.model,
          "| usage:", JSON.stringify(data.usage)
        );
        throw new Error(
          "Model returned empty content. Try a concrete instruct model " +
          "(e.g. openai/gpt-4o-mini) instead of a free/reasoning router."
        );
      }
      // Strip a stray ```json fence if the model wrapped its JSON.
      return content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    },

    // Parse the model's text into validated [{name, tabs:[<tabEl>]}] groups,
    // mapping indices back to real tab elements and using each tab at most once.
    // Any tab the model omitted lands in a trailing "Misc" group.
    parseGroups(text, sourceTabs) {
      const preview = () => text.slice(0, CONFIG.api.outputPreviewMaxChars);
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        Log.ai.debug("Completion was not strict JSON; extracting the first {…} block.");
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) {
          Log.ai.error("Could not extract any JSON object from the model output (truncated):", preview());
          throw new Error("Could not parse model output: " + preview());
        }
        parsed = JSON.parse(match[0]);
      }

      const used = new Set();
      const result = [];
      const groupList = Array.isArray(parsed?.groups) ? parsed.groups : [];
      for (const group of groupList) {
        const members = [];
        for (const index of Array.isArray(group?.tabs) ? group.tabs : []) {
          const tab = sourceTabs[index];
          if (tab && !used.has(index)) {
            used.add(index);
            members.push(tab);
          }
        }
        if (members.length) result.push({ name: group.name || "Group", tabs: members });
      }

      const ungrouped = sourceTabs.filter((_, i) => !used.has(i));
      if (ungrouped.length) {
        Log.ai.debug(`Model left ${ungrouped.length} tab(s) ungrouped; collecting them into a "Misc" group.`);
        result.push({ name: "Misc", tabs: ungrouped });
      }
      Log.ai.debug(`Parsed model output into ${result.length} group(s) covering ${used.size + ungrouped.length} tab(s).`);
      return result;
    },
  };

  // ============================================================================
  // Native Zen tab groups
  // ============================================================================
  const groups = {
    // Create one fresh native group from `members`. To guarantee the new group
    // is never NESTED, any member already in a group is first pulled out to the
    // top level so the insertBefore anchor is always a top-level tab.
    create(members, label, color) {
      if (typeof gBrowser.ungroupTab === "function") {
        for (const tab of members) {
          if (!tab.group) continue;
          try {
            gBrowser.ungroupTab(tab);
          } catch (e) {
            Log.groups.debug("Failed to detach a tab from its current group before regrouping:", e?.message);
          }
        }
      }

      // Try a few option shapes: some builds ignore insertBefore or require
      // isUserTriggered. The first that doesn't throw wins.
      const anchor = members[0];
      const attempts = [
        { label, color, insertBefore: anchor },
        { label, color },
        { label, color, isUserTriggered: true },
      ];
      for (const options of attempts) {
        try {
          const group = gBrowser.addTabGroup(members, options);
          // Some builds ignore the label/color options; set them explicitly.
          if (group) {
            try {
              if (label) setGroupName(group, label);
              if (color) setGroupColor(group, color);
            } catch { /* non-fatal */ }
          }
          return true;
        } catch (e) {
          Log.groups.debug(`addTabGroup attempt failed for group "${label}":`, e?.message);
        }
      }
      Log.groups.error(`Failed to create tab group "${label}" after ${attempts.length} attempts (${members.length} tab(s)).`);
      return false;
    },

    // Map of normalized group-name → group element in the active workspace.
    existingByName() {
      const map = new Map();
      const section = dom.activeSection() || doc;
      for (const groupEl of section.querySelectorAll("tab-group")) {
        const key = normalizeName(getGroupName(groupEl));
        if (key && !map.has(key)) map.set(key, groupEl);
      }
      return map;
    },

    // Apply the model's plan by reconciling against existing groups in place:
    // groups whose name survives keep their position + color, only changed tabs
    // move, and abandoned groups dissolve. No nesting, minimal disruption.
    apply(plan) {
      if (typeof gBrowser.addTabGroup !== "function") {
        throw new Error("gBrowser.addTabGroup is unavailable in this Zen build.");
      }
      const section = dom.activeSection() || doc;
      const existing = groups.existingByName();
      // Snapshot the groups that existed BEFORE we touch anything, so we can
      // evict the ones the plan empties out (see below).
      const before = [...section.querySelectorAll("tab-group")];

      groups.reconcile(plan, existing);

      // Synchronously remove any pre-existing group the plan emptied out. Native
      // dissolve is animated AND deferred, so without this an empty husk keeps
      // painting beneath the freshly built group for a frame (the re-tidy "two
      // stacked groups" flicker). Emptiness is read from the live DOM, not the
      // group's own `.tabs` list, which can lag a frame behind a reparent.
      for (const el of before) {
        if (!el.isConnected) continue;
        if ([...el.querySelectorAll(TAB_SELECTOR)].some(tabs.isAlive)) continue;
        try {
          gBrowser.removeTabGroup?.(el);
        } catch (e) {
          Log.groups.debug("removeTabGroup failed while evicting an emptied group:", e?.message);
        }
        if (el.isConnected) {
          try { el.remove(); } catch { /* already detached */ }
        }
      }
    },

    // In-place reconcile against current groups. Groups whose name survives are
    // KEPT in place (position + color preserved); only the tabs that actually
    // changed are moved. Genuinely new groups are created; groups the plan
    // abandoned empty out and dissolve.
    reconcile(plan, existing) {
      const matched = new Set();
      const usedColors = new Set();
      const palette = CONFIG.grouping.colors;
      let paletteIndex = 0;
      const nextColor = () => {
        let color;
        do { color = palette[paletteIndex++ % palette.length]; }
        while (usedColors.has(color) && paletteIndex <= palette.length);
        usedColors.add(color);
        return color;
      };

      for (const group of plan) {
        const live = group.tabs.filter(tabs.isAlive);
        const dropped = group.tabs.length - live.length;
        if (dropped) Log.groups.warn(`Group "${group.name}": ${dropped} tab(s) were closed during the tidy and will be skipped.`);
        if (!live.length) {
          Log.groups.debug(`Group "${group.name}" has no live tabs after filtering; skipping.`);
          continue;
        }

        const el = existing.get(normalizeName(group.name));
        if (el && typeof el.addTabs === "function") {
          // Keep this group in place; move in only the tabs not already here.
          matched.add(el);
          usedColors.add(getGroupColor(el));
          const toAdd = live.filter((tab) => tab.group !== el);
          if (toAdd.length) {
            Log.groups.debug(`Reusing existing group "${group.name}" in place; adding ${toAdd.length} tab(s).`);
            try { el.addTabs(toAdd); }
            catch (e) { Log.groups.warn(`Failed to add tabs to existing group "${group.name}".`, e); }
          }
        } else {
          const color = nextColor();
          Log.groups.debug(`Creating new group "${group.name}" with ${live.length} tab(s) (color: ${color}).`);
          groups.create(live, group.name, color);
        }
      }

      // Any existing group the plan didn't reuse has had its tabs pulled into
      // other groups; dissolve whatever is left so it doesn't linger.
      for (const [, el] of existing) {
        if (matched.has(el) || !groups.hasLiveTabs(el)) continue;
        try { el.ungroupTabs?.(); }
        catch (e) { Log.groups.warn(`Failed to dissolve the abandoned group "${getGroupName(el) || "?"}".`, e); }
      }
    },

    // Is a group element holding at least one tab that isn't closing?
    hasLiveTabs(groupEl) {
      for (const tab of getGroupTabs(groupEl)) {
        if (tabs.isAlive(tab)) return true;
      }
      return false;
    },

    // Dissolve any group left empty (after a re-tidy, a close, or a manual drag
    // moved its last tab out). Scoped to the active workspace.
    removeEmpty() {
      const section = dom.activeSection() || doc;
      let removed = 0;
      for (const groupEl of [...section.querySelectorAll("tab-group")]) {
        if (groups.hasLiveTabs(groupEl)) continue;
        // Don't dissolve a group the user is mid-rename on.
        if (groupEl.querySelector?.(".zen-tidy-tabs-inline-editing")) continue;
        try {
          // The group is empty, so removing it never closes a live tab.
          if (typeof gBrowser.removeTabGroup === "function") gBrowser.removeTabGroup(groupEl);
          else groupEl.remove();
          removed++;
        } catch (e) {
          try { groupEl.remove(); removed++; }
          catch { Log.groups.warn("Could not remove an empty tab group via API or direct DOM removal.", e); }
        }
      }
      if (removed) Log.groups.debug(`Removed ${removed} empty group(s) from the active workspace.`);
      return removed;
    },

    // Tab removal animates, so a single check can miss a just-emptied group.
    // Poll a few times to reliably catch the group becoming empty.
    scheduleEmptyCheck() {
      let tries = 0;
      const tick = () => {
        groups.removeEmpty();
        if (++tries < CONFIG.timing.emptyCheckMaxTries) setTimeout(tick, CONFIG.timing.emptyCheckIntervalMs);
      };
      setTimeout(tick, CONFIG.timing.emptyCheckDelayMs);
    },

    // Watch the tab strip so groups emptied by native drag-and-drop also get
    // dissolved (the "groups don't always close when empty" bug).
    installEmptyWatcher() {
      if (win.__zenTidyTabsEmptyWatcher) return;
      win.__zenTidyTabsEmptyWatcher = true;
      const root = doc.getElementById("tabbrowser-tabs") || doc.documentElement;
      let pending = null;
      const observer = new win.MutationObserver(() => {
        if (pending) return;
        pending = setTimeout(() => { pending = null; groups.removeEmpty(); }, CONFIG.timing.emptyWatcherDebounceMs);
      });
      observer.observe(root, { childList: true, subtree: true });
      Log.groups.debug("Empty-group watcher installed on", dom.describe(root) + ".");
    },

    // Close every tab in a group (and let the now-empty group dissolve).
    close(groupEl) {
      const members = [...groupEl.querySelectorAll(TAB_SELECTOR)].filter(tabs.isAlive);
      Log.groups.debug(`Closing group "${getGroupName(groupEl)}" and its ${members.length} tab(s).`);
      for (const tab of members) {
        try { gBrowser.removeTab(tab, { animate: true }); }
        catch (e) { Log.groups.warn("Failed to close a tab while closing a group.", e); }
      }
      groups.scheduleEmptyCheck();
    },
  };

  // ============================================================================
  // DOM builders for the modals.
  // ============================================================================
  const make = {
    el(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    },
    field(labelText, control) {
      const field = make.el("div", "zen-tidy-tabs-field");
      field.append(make.el("label", "zen-tidy-tabs-label", labelText), control);
      return field;
    },
    input(value, { type = "text", placeholder = "" } = {}) {
      const input = make.el("input", "zen-tidy-tabs-input");
      input.type = type;
      input.value = value ?? "";
      if (placeholder) input.placeholder = placeholder;
      return input;
    },
    button(text, variant = "") {
      return make.el("button", "zen-tidy-tabs-btn" + (variant ? " " + variant : ""), text);
    },
  };

  // ============================================================================
  // Modal — a single themed overlay + panel, styled to match Zen.
  // ============================================================================
  const modal = {
    keyHandler: null,

    open(title) {
      modal.close();

      const overlay = make.el("div", "zen-tidy-tabs-overlay");
      overlay.id = "zen-tidy-tabs-overlay";

      const panel = make.el("div", "zen-tidy-tabs-modal");
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-label", title);

      const header = make.el("div", "zen-tidy-tabs-modal-header");
      header.append(make.el("div", "zen-tidy-tabs-modal-title", title));
      const closeBtn = make.el("button", "zen-tidy-tabs-modal-close", "✕");
      closeBtn.setAttribute("aria-label", "Close");
      closeBtn.addEventListener("click", modal.close);
      header.append(closeBtn);

      const body = make.el("div", "zen-tidy-tabs-modal-body");
      const footer = make.el("div", "zen-tidy-tabs-modal-footer");
      panel.append(header, body, footer);
      overlay.append(panel);

      // Click outside the panel, or Escape, closes the modal; Tab stays trapped.
      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) modal.close(); });
      modal.keyHandler = (e) => {
        if (e.key === "Escape") modal.close();
        else if (e.key === "Tab") modal.trapFocus(e, panel);
      };
      doc.addEventListener("keydown", modal.keyHandler, true);

      (doc.documentElement || doc.body).appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add("open"));
      return { overlay, body, footer };
    },

    // Cycle focus among the panel's focusable elements instead of escaping to
    // the underlying chrome.
    trapFocus(e, panel) {
      const focusable = [...panel.querySelectorAll(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
      )].filter((el) => !el.disabled && el.offsetParent !== null);
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = doc.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },

    close() {
      if (modal.keyHandler) {
        doc.removeEventListener("keydown", modal.keyHandler, true);
        modal.keyHandler = null;
      }
      doc.getElementById("zen-tidy-tabs-overlay")?.remove();
    },
  };

  // ============================================================================
  // Modal contents — group editor + settings.
  // ============================================================================
  const ui = {
    // A swatch grid bound to the 9 native group colors. Returns the grid and a
    // getter for the current selection.
    colorPicker(initial) {
      const grid = make.el("div", "zen-tidy-tabs-swatches");
      let selected = initial || CONFIG.grouping.colors[0];
      for (const name of CONFIG.grouping.colors) {
        const swatch = make.el("button", "zen-tidy-tabs-swatch");
        swatch.style.setProperty("--swatch", CONFIG.ui.swatchHex[name]);
        swatch.title = name;
        if (name === selected) swatch.classList.add("selected");
        swatch.addEventListener("click", () => {
          selected = name;
          grid.querySelectorAll(".zen-tidy-tabs-swatch").forEach((s) => s.classList.remove("selected"));
          swatch.classList.add("selected");
        });
        grid.append(swatch);
      }
      return { grid, get: () => selected };
    },

    // A segmented single-choice control. options = [[value, text], ...].
    segmentedControl(options, current) {
      let value = current;
      const segment = make.el("div", "zen-tidy-tabs-segment");
      for (const [optionValue, text] of options) {
        const button = make.el("button", "zen-tidy-tabs-seg", text);
        if (optionValue === current) button.classList.add("active");
        button.addEventListener("click", () => {
          value = optionValue;
          segment.querySelectorAll(".zen-tidy-tabs-seg").forEach((s) => s.classList.remove("active"));
          button.classList.add("active");
        });
        segment.append(button);
      }
      return { el: segment, get: () => value };
    },

    // Edit one group: name + color, with a "Close group" action.
    editGroup(group) {
      const { body, footer } = modal.open("Edit group");
      Log.user.debug(`Opened the edit modal for group "${getGroupName(group)}".`);

      const name = make.input(group.label ?? "", { placeholder: "Group name" });
      const picker = ui.colorPicker(group.color);
      body.append(make.field("Name", name), make.field("Color", picker.grid));

      const closeGroup = make.button("Close group", "danger");
      closeGroup.addEventListener("click", () => {
        Log.user.info(`Closing group "${getGroupName(group)}" via the edit modal.`);
        groups.close(group);
        modal.close();
      });

      const cancel = make.button("Cancel", "ghost");
      cancel.addEventListener("click", modal.close);

      const save = make.button("Save changes", "primary");
      save.addEventListener("click", () => {
        const newName = name.value.trim();
        try {
          if (newName) setGroupName(group, newName);
          setGroupColor(group, picker.get());
          Log.user.info(`Group updated: name="${getGroupName(group)}", color="${getGroupColor(group)}".`);
        } catch (e) {
          Log.user.error("Failed to apply group edits (rename / recolor).", e);
        }
        modal.close();
      });

      footer.append(closeGroup, make.el("div", "zen-tidy-tabs-spacer"), cancel, save);
      name.focus();
      name.select();
    },

    // App settings: key, model, label appearance, and what's sent to the AI.
    settings() {
      const { body, footer } = modal.open("Zen Tidy Tabs Settings");
      Log.user.debug("Opened the settings modal.");

      const key = make.input(prefs.apiKey(), { type: "password", placeholder: "sk-or-v1-..." });
      const model = make.input(prefs.model(), { placeholder: CONFIG.api.defaultModel });

      // Model suggestions via a datalist.
      const modelListId = "zen-tidy-tabs-model-list";
      const datalist = make.el("datalist");
      datalist.id = modelListId;
      for (const slug of CONFIG.api.suggestedModels) {
        const option = make.el("option");
        option.value = slug;
        datalist.append(option);
      }
      model.setAttribute("list", modelListId);

      const labelSegment = ui.segmentedControl(
        [["filled", "Colored"], ["text", "Text only"]],
        prefs.labelStyle()
      );
      const urlSegment = ui.segmentedControl(
        [["detailed", "Detailed"], ["compact", "Compact"], ["minimal", "Minimal"]],
        prefs.urlMode()
      );
      const urlHint = make.el(
        "p", "zen-tidy-tabs-hint",
        "What each tab sends to the AI — Detailed: title + URL · Compact: title + domain · " +
        "Minimal: title only. Query strings are never sent."
      );

      const keyHint = make.el("p", "zen-tidy-tabs-hint");
      keyHint.append(doc.createTextNode("Key is stored locally. Get one at "));
      const link = make.el("a", "zen-tidy-tabs-link", "openrouter.ai/keys");
      link.addEventListener("click", () => win.openTrustedLinkIn?.("https://openrouter.ai/keys", "tab"));
      keyHint.append(link, doc.createTextNode("."));

      body.append(
        make.field("OpenRouter API key", key),
        make.field("Model", model),
        datalist,
        make.field("Group labels", labelSegment.el),
        make.field("Tab info sent to AI", urlSegment.el),
        urlHint,
        keyHint
      );

      const cancel = make.button("Cancel", "ghost");
      cancel.addEventListener("click", modal.close);

      const save = make.button("Save settings", "primary");
      save.addEventListener("click", () => {
        prefs.set(CONFIG.prefs.apiKey, key.value.trim());
        prefs.set(CONFIG.prefs.model, model.value.trim());
        prefs.set(CONFIG.prefs.labelStyle, labelSegment.get());
        prefs.set(CONFIG.prefs.urlMode, urlSegment.get());
        Log.user.info(`Settings saved (model: ${model.value.trim() || CONFIG.api.defaultModel}, labelStyle: ${labelSegment.get()}, urlMode: ${urlSegment.get()}, apiKey: ${key.value.trim() ? "set" : "empty"}).`);
        styles.inject(); // re-apply label appearance immediately
        modal.close();
        orchestrator.notify("Settings saved.");
      });

      footer.append(make.el("div", "zen-tidy-tabs-spacer"), cancel, save);
      key.focus();
    },
  };

  // ============================================================================
  // The Tidy control — a hover-reveal twin of Zen's Clear button.
  // ============================================================================
  const control = {
    // Build the control. When `twin` (the Clear button) is given, clone its
    // element type + classes so it inherits Clear's look and hover behavior.
    // Clear may show its text via a `label` attribute (XUL), so set both.
    build(twin) {
      const el = doc.createElement(twin ? twin.tagName : "span");
      el.id = CONFIG.ui.controlId;
      el.textContent = CONFIG.ui.label;
      el.setAttribute("label", CONFIG.ui.label);
      el.setAttribute("tooltiptext", "Tidy tabs with AI");
      el.title = "Tidy tabs with AI";
      el.className = twin ? twin.className : "zen-tidy-tabs-fallback";
      if (twin) el.dataset.twin = "1";

      const tidy = (e) => {
        e.preventDefault();
        e.stopPropagation();
        Log.user.debug("Tidy control activated (click / command).");
        orchestrator.runTidy();
      };
      el.addEventListener("click", tidy);
      el.addEventListener("command", tidy); // XUL buttons fire command
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        Log.user.debug("Tidy control right-clicked; opening settings.");
        ui.settings();
      });
      return el;
    },

    // Insert the control as a twin right next to Clear. Returns true once a twin
    // is in place. Idempotent: skips work if a twin already exists.
    placeTwinIfClearPresent() {
      const existing = doc.getElementById(CONFIG.ui.controlId);
      if (existing?.dataset?.twin === "1" && existing.isConnected) return true;
      const clear = dom.clearControl();
      if (!clear?.parentElement) return false;
      existing?.remove();
      clear.parentElement.insertBefore(control.build(clear), clear);
      Log.dom.info("Tidy control mounted as a twin of the Clear button (" + dom.describe(clear) + ").");
      return true;
    },

    // Some builds only add the Clear control while the separator is hovered.
    // Watch for that and place the twin the moment Clear appears; the watcher
    // stays installed so the twin is re-created if Zen rebuilds the row.
    installClearWatcher() {
      if (win.__zenTidyTabsClearWatcher) return;
      win.__zenTidyTabsClearWatcher = true;
      // Hover anywhere in the chrome: cheap because placeTwinIfClearPresent
      // early-returns once a twin exists.
      const target = doc.documentElement;
      target.addEventListener("mouseover", () => control.placeTwinIfClearPresent(), true);
      Log.dom.debug("Clear-button hover watcher installed on", dom.describe(target) + ".");
    },

    // Mount: twin beside Clear if present; else a hover-reveal fallback on the
    // separator; always install the watcher to upgrade to a twin when Clear shows.
    mount() {
      control.installClearWatcher();
      if (control.placeTwinIfClearPresent()) return true;

      if (!doc.getElementById(CONFIG.ui.controlId)) {
        const section = dom.activeSection();
        const anchor = section && dom.firstNormalNode(section);
        if (anchor?.parentElement) {
          anchor.parentElement.insertBefore(control.build(null), anchor);
          Log.dom.info("Tidy control mounted via separator fallback (hover to reveal; will upgrade to a Clear twin when one appears).");
          return true;
        }
      }

      Log.dom.debug("No mount target available yet; will retry or wait for a hover.");
      return !!doc.getElementById(CONFIG.ui.controlId);
    },

    setBusy(busy) {
      const el = doc.getElementById(CONFIG.ui.controlId);
      if (!el) return;
      el.textContent = busy ? CONFIG.ui.busyLabel : CONFIG.ui.label;
      el.setAttribute("label", busy ? CONFIG.ui.busyLabel : CONFIG.ui.label);
      el.style.pointerEvents = busy ? "none" : "";
    },
  };

  // ============================================================================
  // Group label editing.
  //   single click (settled for CONFIG.timing.doubleClickMs) → inline rename
  //   double click (2nd click within that window)            → full edit modal
  // The debounce disambiguates the two so a double-click never leaves the label
  // stuck in the inline-edit state.
  // ============================================================================
  const editor = {
    clickTimer: null,
    active: null, // { labelEl, group, original, cleanup }

    install() {
      if (win.__zenTidyTabsEditorInstalled) return;
      win.__zenTidyTabsEditorInstalled = true;

      doc.addEventListener("click", (e) => {
        const labelEl = e.target?.closest?.(".tab-group-label");
        if (!labelEl) return;
        const group = labelEl.closest("tab-group");
        if (!group) return;

        // Already editing this label? Let the click position the caret.
        if (editor.active?.labelEl === labelEl) return;

        // We own this interaction: block Zen's native click (collapse / its own
        // inline edit) so single vs double is decided here.
        e.preventDefault();
        e.stopPropagation();

        if (editor.clickTimer) {
          // Second click within the window → double-click → full edit modal.
          clearTimeout(editor.clickTimer);
          editor.clickTimer = null;
          editor.cancelInline();
          if (!doc.getElementById("zen-tidy-tabs-overlay")) ui.editGroup(group);
          return;
        }
        // First click → wait to see whether a second one arrives.
        editor.clickTimer = setTimeout(() => {
          editor.clickTimer = null;
          editor.startInline(group, labelEl);
        }, CONFIG.timing.doubleClickMs);
      }, true); // capture, so we act before the label's own handler

      Log.user.debug("Group label editor installed (single click renames inline, double click opens the edit modal).");
    },

    startInline(group, labelEl) {
      editor.cancelInline();
      const original = (group.label ?? labelEl.textContent ?? "").trim();
      labelEl.setAttribute("contenteditable", "true");
      labelEl.classList.add("zen-tidy-tabs-inline-editing");
      labelEl.focus();
      try {
        const range = doc.createRange();
        range.selectNodeContents(labelEl);
        const selection = win.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      } catch { /* selection not critical */ }

      const commit = () => {
        const name = (labelEl.textContent || "").trim();
        editor.finishInline();
        if (name && name !== original) {
          try {
            setGroupName(group, name);
            Log.user.info(`Renamed group "${original}" to "${name}".`);
          } catch (e) {
            Log.user.error(`Failed to rename group "${original}" to "${name}"; restoring the previous name.`, e);
            labelEl.textContent = original;
          }
        } else {
          labelEl.textContent = original;
        }
      };

      const onKey = (e) => {
        if (e.key === "Enter") { e.preventDefault(); labelEl.blur(); }
        else if (e.key === "Escape") { e.preventDefault(); labelEl.textContent = original; labelEl.blur(); }
        e.stopPropagation();
      };

      labelEl.addEventListener("keydown", onKey, true);
      labelEl.addEventListener("blur", commit, { once: true });
      editor.active = {
        labelEl,
        group,
        original,
        cleanup: () => labelEl.removeEventListener("keydown", onKey, true),
      };
    },

    finishInline() {
      const state = editor.active;
      if (!state) return;
      editor.active = null;
      state.cleanup?.();
      state.labelEl.removeAttribute("contenteditable");
      state.labelEl.classList.remove("zen-tidy-tabs-inline-editing");
    },

    // Abandon an in-progress inline edit, restoring the original name.
    cancelInline() {
      const state = editor.active;
      if (!state) return;
      state.labelEl.textContent = state.original;
      editor.finishInline();
    },
  };

  // ============================================================================
  // Styles — only our control; groups keep Zen's native appearance.
  // ============================================================================
  const styles = {
    // CSS variables resolved against Zen's palette, with dark fallbacks.
    theme: {
      bg: "var(--zen-main-browser-background, #1f1e25)",
      elevated: "var(--zen-colors-tertiary, #2a2833)",
      border: "var(--zen-colors-border, #3a3845)",
      text: "var(--zen-primary-color, #ECECEC)",
      muted: "#9b99a6",
      accent: "var(--zen-primary-color, #6c5ce7)",
    },

    // Text-only labels (Arc-style): drop the colored background and render the
    // name in a neutral, theme-aware weight. Empty when the default "filled"
    // style is on.
    labelStyleCss() {
      if (prefs.labelStyle() !== "text") return "";
      return `
        .tab-group-label {
          background: transparent !important;
          color: var(--zen-primary-color, #ECECEC) !important;
          opacity: .72;
          font-weight: 700 !important;
          letter-spacing: .01em;
          text-shadow: none !important;
        }
        .tab-group-label:hover { opacity: .9; }
      `;
    },

    inject() {
      const t = styles.theme;
      doc.getElementById(CONFIG.ui.styleId)?.remove();
      const style = doc.createElement("style");
      style.id = CONFIG.ui.styleId;
      style.textContent = `
        /* ---- Tidy control: twin of Clear ---- */
        #${CONFIG.ui.controlId} {
          cursor: pointer;
          color: inherit !important;
          font: inherit !important;
          background: none !important;
          border: none !important;
          box-shadow: none !important;
        }
        #${CONFIG.ui.controlId}::before { content: none !important; }
        #${CONFIG.ui.controlId}.zen-tidy-tabs-fallback {
          display: block !important;
          visibility: visible !important;
          box-sizing: border-box;
          width: calc(100% - 12px);
          margin: 2px 6px;
          padding: 2px 6px;
          text-align: right;
          font-size: 12px;
          color: ${t.accent} !important;
          opacity: 0;
          transition: opacity .12s ease;
        }
        .zen-workspace-tabs-section:hover #${CONFIG.ui.controlId}.zen-tidy-tabs-fallback { opacity: .85; }
        #${CONFIG.ui.controlId}.zen-tidy-tabs-fallback:hover { opacity: 1; }

        /* ---- Modal ---- */
        .zen-tidy-tabs-overlay {
          position: fixed; inset: 0; z-index: 2147483647;
          display: flex; align-items: center; justify-content: center;
          background: rgba(0,0,0,.45);
          -moz-window-dragging: no-drag;
          opacity: 0; transition: opacity .14s ease;
        }
        .zen-tidy-tabs-overlay.open { opacity: 1; }
        .zen-tidy-tabs-modal {
          width: 340px; max-width: calc(100vw - 32px);
          background: ${t.bg};
          color: ${t.text};
          border: 1px solid ${t.border};
          border-radius: 14px;
          box-shadow: 0 18px 48px rgba(0,0,0,.5);
          font: menu;
          overflow: hidden;
          transform: translateY(6px) scale(.985);
          transition: transform .14s ease;
        }
        .zen-tidy-tabs-overlay.open .zen-tidy-tabs-modal { transform: none; }
        .zen-tidy-tabs-modal-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 16px 10px;
        }
        .zen-tidy-tabs-modal-title { font-size: 14px; font-weight: 600; }
        .zen-tidy-tabs-modal-close {
          all: unset; cursor: pointer; color: ${t.muted};
          width: 22px; height: 22px; border-radius: 6px; text-align: center;
        }
        .zen-tidy-tabs-modal-close:hover { background: ${t.elevated}; color: ${t.text}; }
        .zen-tidy-tabs-modal-body { padding: 4px 16px 8px; display: flex; flex-direction: column; gap: 14px; }
        .zen-tidy-tabs-modal-footer {
          display: flex; align-items: center; gap: 8px;
          padding: 12px 16px 16px;
        }
        .zen-tidy-tabs-spacer { flex: 1; }

        .zen-tidy-tabs-field { display: flex; flex-direction: column; gap: 6px; }
        .zen-tidy-tabs-label { font-size: 11px; color: ${t.muted}; font-weight: 600; }
        .zen-tidy-tabs-input {
          all: unset; box-sizing: border-box; width: 100%;
          padding: 8px 10px; font-size: 13px;
          color: ${t.text};
          background: ${t.elevated};
          border: 1px solid ${t.border}; border-radius: 9px;
        }
        .zen-tidy-tabs-input:focus-within, .zen-tidy-tabs-input:focus {
          border-color: ${t.accent};
        }

        /* ---- Color swatches (the 9 native group colors) ---- */
        .zen-tidy-tabs-swatches { display: flex; flex-wrap: wrap; gap: 10px; padding: 2px 0; }
        .zen-tidy-tabs-swatch {
          all: unset; cursor: pointer;
          width: 26px; height: 26px; border-radius: 50%;
          background: var(--swatch);
          box-shadow: 0 0 0 2px transparent, 0 1px 3px rgba(0,0,0,.3);
          transition: box-shadow .12s ease, transform .12s ease;
        }
        .zen-tidy-tabs-swatch:hover { transform: scale(1.08); }
        .zen-tidy-tabs-swatch.selected {
          box-shadow: 0 0 0 2px ${t.bg}, 0 0 0 4px var(--swatch);
        }

        /* ---- Segmented control ---- */
        .zen-tidy-tabs-segment {
          display: inline-flex; flex-wrap: wrap; padding: 3px; gap: 3px;
          background: ${t.elevated}; border: 1px solid ${t.border};
          border-radius: 10px;
        }
        .zen-tidy-tabs-seg {
          all: unset; cursor: pointer; padding: 5px 12px; font-size: 12px;
          color: ${t.muted}; border-radius: 7px; text-align: center;
        }
        .zen-tidy-tabs-seg.active { background: ${t.accent}; color: #fff; }

        .zen-tidy-tabs-hint { margin: 2px 0 0; font-size: 11px; color: ${t.muted}; }
        .zen-tidy-tabs-link { color: ${t.accent}; cursor: pointer; text-decoration: underline; }

        /* ---- Buttons ---- */
        .zen-tidy-tabs-btn {
          all: unset; cursor: pointer; padding: 7px 14px; font-size: 13px; font-weight: 600;
          border-radius: 9px; color: ${t.text}; background: ${t.elevated};
          border: 1px solid ${t.border}; text-align: center;
        }
        .zen-tidy-tabs-btn:hover { filter: brightness(1.12); }
        .zen-tidy-tabs-btn.primary { background: ${t.accent}; border-color: transparent; color: #fff; }
        .zen-tidy-tabs-btn.ghost { background: transparent; }
        .zen-tidy-tabs-btn.danger { background: transparent; border-color: transparent; color: #e26d6d; }
        .zen-tidy-tabs-btn.danger:hover { background: rgba(226,109,109,.14); filter: none; }

        /* ---- Inline group rename ---- */
        .tab-group-label.zen-tidy-tabs-inline-editing {
          outline: 1px solid ${t.accent} !important;
          outline-offset: 1px;
          border-radius: 5px;
          cursor: text;
          -moz-user-select: text;
          user-select: text;
        }

        ${styles.labelStyleCss()}
      `;
      (doc.head || doc.documentElement).appendChild(style);
      Log.styles.debug(`Stylesheet injected (#${CONFIG.ui.styleId}, labelStyle: ${prefs.labelStyle()}).`);
    },
  };

  // ============================================================================
  // Orchestration
  // ============================================================================
  const orchestrator = {
    running: false,

    notify(message, isError = false) {
      (isError ? Log.tidy.error : Log.tidy.info)(message);
      try {
        const box = gBrowser.getNotificationBox();
        box.appendNotification(
          "zen-tidy-tabs-msg",
          {
            label: "Zen Tidy Tabs: " + message,
            priority: isError ? box.PRIORITY_WARNING_HIGH : box.PRIORITY_INFO_LOW,
          },
          []
        );
        setTimeout(() => {
          const note = box.getNotificationWithValue?.("zen-tidy-tabs-msg");
          if (note) box.removeNotification(note);
        }, CONFIG.timing.notifyDurationMs);
      } catch {
        /* notification box unavailable — the console log above already fired */
      }
    },

    async runTidy() {
      if (orchestrator.running) {
        Log.tidy.debug("Ignoring Tidy request: a tidy run is already in progress.");
        return;
      }

      const apiKey = prefs.apiKey();
      if (!apiKey) {
        Log.tidy.warn("Tidy aborted: no OpenRouter API key configured.");
        orchestrator.notify("Set your key in about:config → " + CONFIG.prefs.apiKey, true);
        return;
      }

      // Re-tidy considers the entire workspace, not just new tabs.
      const sourceTabs = tabs.collect(true);
      if (sourceTabs.length < CONFIG.grouping.minTabs) {
        Log.tidy.warn(`Tidy aborted: only ${sourceTabs.length} eligible tab(s), need at least ${CONFIG.grouping.minTabs}.`);
        orchestrator.notify(`Need at least ${CONFIG.grouping.minTabs} tabs to tidy.`, true);
        return;
      }

      orchestrator.running = true;
      control.setBusy(true);
      try {
        Log.tidy.info(`Starting tidy of ${sourceTabs.length} tab(s) (model: ${prefs.model()}, urlMode: ${prefs.urlMode()}).`);
        const response = await ai.request(tabs.snapshot(sourceTabs), apiKey, prefs.model());
        const plan = ai.parseGroups(ai.extractText(response), sourceTabs);
        Log.tidy.info("Grouping plan:", plan.map((g) => `${g.name}(${g.tabs.length})`).join(", "));

        groups.apply(plan);
        groups.scheduleEmptyCheck();
        Log.tidy.info(`Tidy complete: sorted ${sourceTabs.length} tab(s) into ${plan.length} group(s).`);
        orchestrator.notify(`Sorted ${sourceTabs.length} tabs into ${plan.length} groups.`);
      } catch (e) {
        Log.tidy.error("Tidy run failed.", e);
        orchestrator.notify("failed: " + (e.message || e), true);
      } finally {
        orchestrator.running = false;
        control.setBusy(false);
      }
    },
  };

  // ============================================================================
  // Diagnostics — one-shot DOM dump. Reveals what "Clear" actually is and how
  // the sidebar is laid out, so placement can be targeted precisely. Debug-only.
  // ============================================================================
  const diag = {
    pseudo(el, which) {
      try { return win.getComputedStyle(el, which).content || ""; } catch { return ""; }
    },

    path(el, depth = 8) {
      const parts = [];
      let current = el;
      for (let i = 0; current && i < depth; i++) {
        parts.unshift(dom.describe(current));
        current = current.parentElement;
      }
      return parts.join(" > ");
    },

    // Every element whose text / label / tooltip / pseudo says "clear".
    clearCandidates() {
      const hits = [];
      const selector = "toolbarbutton, button, label, span, hbox, vbox, toolbaritem, div, image, [label], [tooltiptext]";
      for (const el of doc.querySelectorAll(selector)) {
        const text = (el.textContent || "").trim();
        const label = el.getAttribute?.("label") || "";
        const tip = el.getAttribute?.("tooltiptext") || "";
        const pseudo = el.children.length ? "" : diag.pseudo(el, "::before") + diag.pseudo(el, "::after");
        if (/clear/i.test(`${text} ${label} ${tip} ${pseudo}`)) {
          hits.push({ el, text, label, tip, pseudo });
        }
      }
      return hits;
    },

    newTabButton() {
      return (
        doc.getElementById("tabs-newtab-button") ||
        doc.querySelector("[command='cmd_newNavigatorTab'], .tabs-newtab-button, #vertical-tabs-newtab-button") ||
        [...doc.querySelectorAll("toolbarbutton, button")].find((b) =>
          /new tab/i.test((b.getAttribute("label") || "") + " " + (b.textContent || ""))
        ) ||
        null
      );
    },

    run() {
      Log.diagnose.info("================= DOM DIAGNOSIS =================");

      const selectedTab = gBrowser.selectedTab;
      Log.diagnose.info("selectedTab:", dom.describe(selectedTab));
      Log.diagnose.info("  ancestry:", diag.path(selectedTab));

      const section = dom.activeSection();
      Log.diagnose.info("activeSection:", dom.describe(section));
      if (section) {
        Log.diagnose.info("  children:", [...section.children].map((c) => dom.describe(c)).join("  |  "));
      }
      Log.diagnose.info("firstNormalNode:", section ? dom.describe(dom.firstNormalNode(section)) : "n/a");

      Log.diagnose.info("clearControl() result:", dom.describe(dom.clearControl()));

      const hits = diag.clearCandidates();
      Log.diagnose.info("'clear' candidates found:", hits.length);
      hits.slice(0, 12).forEach((hit, i) => {
        Log.diagnose.info(`  [${i}] ${dom.describe(hit.el)}`);
        Log.diagnose.info(`       text="${hit.text.slice(0, 24)}" label="${hit.label}" tip="${hit.tip}" pseudo=${JSON.stringify(hit.pseudo).slice(0, 40)}`);
        Log.diagnose.info(`       path: ${diag.path(hit.el, 6)}`);
      });

      const newTab = diag.newTabButton();
      Log.diagnose.info("newTab button:", dom.describe(newTab));
      if (newTab?.parentElement) {
        Log.diagnose.info("  newTab siblings:", [...newTab.parentElement.children].map((c) => dom.describe(c)).join("  |  "));
        Log.diagnose.info("  newTab parent path:", diag.path(newTab.parentElement, 6));
      }

      Log.diagnose.info("================ END DIAGNOSIS =================");
    },
  };

  // ============================================================================
  // Init — mount the control (polling until the sidebar DOM exists), inject
  // styles, and install the group editor + empty-group watcher.
  // ============================================================================
  const init = () => {
    Log.init.info("Loading Zen Tidy Tabs…");
    Log.init.debug("location:", (() => { try { return location.href; } catch { return "?"; } })());
    Log.init.debug(`Environment: gBrowser.addTabGroup is ${typeof gBrowser.addTabGroup}, ${gBrowser.tabs.length} tab(s) open.`);

    styles.inject();
    editor.install();
    groups.installEmptyWatcher();
    if (CONFIG.debug) diag.run();

    if (!control.mount()) {
      let attempts = 0;
      const timer = setInterval(() => {
        if (control.mount() || ++attempts > CONFIG.timing.mountMaxAttempts) {
          clearInterval(timer);
          if (!doc.getElementById(CONFIG.ui.controlId)) {
            Log.dom.warn(`Tidy control not placed after ${attempts} attempt(s); it will appear when you hover the tab separator.`);
          }
        }
      }, CONFIG.timing.mountRetryMs);
    }

    // Manual controls for debugging from the Browser Console.
    win.zenTidyTabs = {
      run: () => orchestrator.runTidy(),
      settings: () => ui.settings(),
      mount: () => control.mount(),
      diagnose: () => diag.run(),
      injectStyles: () => styles.inject(),
      collect: (grouped = true) => tabs.collect(grouped),
    };
    Log.init.info("Ready — left-click the Tidy control to organize tabs; right-click it for settings.");
  };

  init();
})();
