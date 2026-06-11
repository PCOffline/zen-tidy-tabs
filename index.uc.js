// ==UserScript==
// @name           Zen Tidy Tabs
// @description    Arc-style AI tab tidying integrated into Zen's native sidebar.
//                 Adds a hover-reveal "Tidy" control next to Zen's Clear button.
//                 Clicking it asks an LLM (via OpenRouter) to cluster the open
//                 tabs, then builds native Zen tab groups. Double-click a group
//                 label to rename / recolor it.
// @author         PCOffline
// @include        main
// ==/UserScript==

(() => {
  "use strict";

  // ============================================================================
  // Configuration — everything tweakable lives here.
  // ============================================================================
  const CONFIG = {
    debug: false,

    prefs: {
      apiKey: "zen-tidy-tabs.apikey",     // OpenRouter key (sk-or-v1-...)
      model: "zen-tidy-tabs.model",        // optional model slug override
      labelStyle: "zen-tidy-tabs.labelstyle", // "filled" | "text"
      urlMode: "zen-tidy-tabs.urlmode",    // "detailed" | "compact" | "minimal"
    },
    api: {
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      defaultModel: "openai/gpt-4o-mini",
      maxTokens: 2048,      // floor; scaled up with tab count (see ai.request)
      maxTokensCeiling: 8192,
      temperature: 0.2,     // low → stable, repeatable clustering
      seed: 7,              // passed through to providers that support it
      timeoutMs: 90000,     // abort a hung request instead of locking the button
      // Sent as OpenRouter attribution headers.
      referer: "https://github.com/PCOffline/zen-tidy-tabs",
      title: "Zen Tidy Tabs",
      // Offered as quick suggestions in the settings modal.
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
      // Display approximations of the 9 native group colors (the picker is
      // limited to these because Firefox tab groups only accept named colors).
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
      minTabs: 2, // refuse to tidy fewer than this
    },

    snapshot: {
      titleMax: 160, // truncate long titles before sending to the model
      urlMax: 120,   // truncate long URLs too
    },
  };

  // ============================================================================
  // Logging — log() always prints; debug() only when CONFIG.debug is on.
  // ============================================================================
  const PREFIX = "[Zen Tidy Tabs]";
  const log = (...args) => console.log(PREFIX, ...args);
  const warn = (...args) => console.warn(PREFIX, ...args);
  const fail = (...args) => console.error(PREFIX, ...args);
  const debug = (...args) => { if (CONFIG.debug) console.log(PREFIX, ...args); };

  // ============================================================================
  // Environment — resolve the chrome window that owns gBrowser exactly once.
  //
  // Strategy: prefer the script's own `window`. When the script is pasted into
  // the Browser Console, `window` may be the console's global (no gBrowser), so
  // fall back to the most-recent browser window via the window mediator.
  // ============================================================================
  const env = (() => {
    let win = typeof window !== "undefined" ? window : null;
    if (!win || !win.gBrowser) {
      try {
        const mru = Services.wm.getMostRecentWindow("navigator:browser");
        if (mru?.gBrowser) win = mru;
      } catch (e) {
        fail("could not resolve a browser window:", e);
      }
    }
    return win && win.gBrowser
      ? { win, doc: win.document, gBrowser: win.gBrowser }
      : null;
  })();

  if (!env) {
    fail("FATAL: no gBrowser. Run this in the Browser Console (Ctrl+Shift+J)");
    fail("with devtools.chrome.enabled = true — the web console (F12) won't work.");
    return;
  }

  const { win, doc, gBrowser } = env;

  // ============================================================================
  // DOM access — every selector strategy is documented and isolated here, so
  // that when Zen changes its internals there is exactly one place to update.
  // ============================================================================
  const dom = {
    // The active workspace's tab section.
    //
    // Strategy: Zen renders one `.zen-workspace-tabs-section` per workspace and
    // keeps them all in the DOM. The selected tab is always inside the active
    // one, so we climb from it. Fallbacks: an explicitly-flagged [active]
    // section, then simply the first section.
    activeSection() {
      const fromSelected = gBrowser.selectedTab?.closest?.(".zen-workspace-tabs-section");
      return (
        fromSelected ||
        doc.querySelector(".zen-workspace-tabs-section[active]") ||
        doc.querySelector(".zen-workspace-tabs-section")
      );
    },

    // Zen's existing "Clear" control (added by another mod / Zen itself).
    //
    // Strategy: it has no stable id/class, and it may render its text via a
    // `label` attribute (XUL toolbarbutton) or a CSS pseudo-element rather than
    // as text content — so we check all three. Scoped to the tab strip for speed.
    clearControl() {
      const scopes = [doc.getElementById("tabbrowser-tabs"), dom.activeSection(), doc].filter(Boolean);
      const seen = new Set();
      const selector =
        "toolbarbutton, button, label, span, hbox, vbox, toolbaritem, [label], [tooltiptext]";
      for (const scope of scopes) {
        for (const el of scope.querySelectorAll(selector)) {
          if (seen.has(el)) continue;
          seen.add(el);

          const label = (el.getAttribute?.("label") || "").trim().toLowerCase();
          if (label === "clear") return el;

          const text = (el.textContent || "").trim().toLowerCase();
          if (text === "clear") return el; // exact, so we never match a big container

          if (!el.children.length) {
            try {
              for (const pseudo of ["::before", "::after"]) {
                const content = win.getComputedStyle(el, pseudo).content || "";
                if (/clear/i.test(content)) return el;
              }
            } catch { /* detached node */ }
          }
        }
      }
      return null;
    },

    // The pinned/normal boundary inside a section = the first normal tab or
    // tab-group (skipping pinned/essential tabs). Used only for fallback
    // placement when there is no Clear control to sit beside.
    firstNormalNode(section) {
      const nodes = section.querySelectorAll("tab-group, tab, .tabbrowser-tab");
      for (const el of nodes) {
        if (dom.isGroupEl(el)) return el;
        if (!(el.pinned || el.hasAttribute?.("zen-essential"))) return el;
      }
      return null;
    },

    // The <tab-group> owning a double-clicked label, or null.
    groupFromEvent(target) {
      return target?.closest?.(".tab-group-label")?.closest?.("tab-group") || null;
    },

    isGroupEl(el) {
      return (el?.tagName || "").toLowerCase() === "tab-group" || el?.classList?.contains?.("tab-group");
    },

    describe(el) {
      if (!el) return "null";
      return (el.tagName || "?").toLowerCase() + (el.id ? "#" + el.id : "") +
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
      try { Services.prefs.setStringPref(name, value ?? ""); } catch (e) { fail("could not save pref", name, e); }
    },
    apiKey() { return prefs.get(CONFIG.prefs.apiKey); },
    model() { return prefs.get(CONFIG.prefs.model, CONFIG.api.defaultModel); },
    labelStyle() { return prefs.get(CONFIG.prefs.labelStyle, "filled"); },
    urlMode() {
      const v = prefs.get(CONFIG.prefs.urlMode, "detailed");
      return ["detailed", "compact", "minimal"].includes(v) ? v : "detailed";
    },
  };

  // ============================================================================
  // Tabs
  // ============================================================================
  const tabs = {
    // Tabs in the active workspace that we may organize.
    //
    // includeGrouped=false → only ungrouped tabs (e.g. for a status readout).
    // includeGrouped=true  → every eligible tab, so a re-tidy reconsiders the
    //                        whole structure (tabs can leave/merge groups).
    collect(includeGrouped) {
      const workspaceId = win.gZenWorkspaces?.activeWorkspace ?? null;
      return gBrowser.tabs.filter((t) => {
        if (t.pinned || t.hidden || t.closing) return false;
        if (!includeGrouped && t.group) return false;
        if (t.hasAttribute("zen-empty-tab") || t.hasAttribute("zen-glance-tab")) return false;
        const tabWorkspace = t.getAttribute("zen-workspace-id");
        if (workspaceId && tabWorkspace && tabWorkspace !== workspaceId) return false;
        return true;
      });
    },

    // A tab is still usable if it hasn't been closed during the async API call.
    isAlive(t) {
      return t && !t.closing && t.isConnected && gBrowser.tabs.includes(t);
    },

    title(t) { return (t.label || "").slice(0, CONFIG.snapshot.titleMax); },
    rawUrl(t) { return t.linkedBrowser?.currentURI?.spec || ""; },

    // Build the URL string sent for a tab, per the user's detail preference.
    // The query string and hash are ALWAYS stripped (never sent to the model):
    //   detailed → title + domain + path     (default)
    //   compact  → title + hostname only
    //   minimal  → title only (no URL at all)
    formatUrl(spec, mode) {
      if (!spec || mode === "minimal") return "";
      if (mode === "compact") {
        try { return new win.URL(spec).hostname; } catch { return ""; }
      }
      // detailed: drop ?query and #hash; works for http(s), about:, chrome:, etc.
      return spec.split("?")[0].split("#")[0].slice(0, CONFIG.snapshot.urlMax);
    },

    // The name of the group a tab currently lives in, or "" if ungrouped.
    groupName(t) {
      const g = t.group;
      if (!g) return "";
      return (g.label || g.getAttribute?.("label") || "").trim();
    },

    // Compact [{i, title, url?, group?}] list for the model. `url` honors the
    // user's privacy mode (omitted entirely in "title" mode); `group` is only
    // included when the tab is already grouped, so a re-tidy can keep stable
    // groupings instead of reinventing names every run.
    snapshot(list) {
      const mode = prefs.urlMode();
      return list.map((t, i) => {
        const entry = { i, title: tabs.title(t) };
        const url = tabs.formatUrl(tabs.rawUrl(t), mode);
        if (url) entry.url = url;
        const group = tabs.groupName(t);
        if (group) entry.group = group;
        return entry;
      });
    },
  };

  // ============================================================================
  // AI categorization
  // ============================================================================
  const ai = {
    // The prompt encodes an opinionated stance on what a *good* grouping is,
    // a naming rubric, hard constraints, an output contract, and one worked
    // example — so even small/cheap models produce consistent, clean JSON.
    buildPrompt(snapshot) {
      const n = snapshot.length;
      const lastIndex = n - 1;
      // Allow a single group when everything shares a theme; cap groups so we
      // never shatter a small workspace into many singletons.
      const cap = Math.min(8, Math.max(2, Math.ceil(n / 3)));
      const hasGroups = snapshot.some((t) => t.group);
      return [
        `You are "Tidy", an engine that organizes a browser sidebar's open tabs`,
        `into a small set of clean, intuitive groups — like Arc's "Tidy Tabs".`,
        ``,
        `## Input`,
        `${n} tabs. Each object has {"i": <index 0-${lastIndex}>, "title": <string>}`,
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
        `1. Produce between 1 and ${cap} groups (1 is fine if every tab shares one theme).`,
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
      const n = snapshot.length;
      const max_tokens = Math.min(
        CONFIG.api.maxTokensCeiling,
        Math.max(CONFIG.api.maxTokens, n * 24 + 256)
      );
      const body = {
        model,
        temperature: CONFIG.api.temperature,
        seed: CONFIG.api.seed,
        max_tokens,
        // Ask the provider to guarantee a JSON object. Hugely improves
        // reliability; we degrade gracefully if a model rejects it.
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
        return await ai._post(body, apiKey);
      } catch (e) {
        // Some models/providers reject response_format. Retry once without it.
        if (e?.status === 400 && /response_format|json/i.test(e.message || "")) {
          warn("model rejected response_format; retrying without it");
          delete body.response_format;
          return await ai._post(body, apiKey);
        }
        throw e;
      }
    },

    // POST to OpenRouter with a hard timeout so a hung request can never lock
    // the Tidy button indefinitely.
    async _post(body, apiKey) {
      debug("calling OpenRouter, model:", body.model);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CONFIG.api.timeoutMs);
      let res;
      try {
        res = await fetch(CONFIG.api.endpoint, {
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
          throw new Error(`OpenRouter request timed out after ${CONFIG.api.timeoutMs / 1000}s`);
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }

      debug("API responded HTTP", res.status);
      if (!res.ok) {
        const err = new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    },

    // Pull the assistant text out of an OpenRouter/OpenAI response, tolerating
    // array-style content and reasoning-only replies.
    extractText(data) {
      if (data.error) {
        throw new Error("API error: " + (data.error.message || JSON.stringify(data.error)));
      }
      const message = data.choices?.[0]?.message;
      let content = message?.content;
      if (Array.isArray(content)) {
        content = content.map((part) => part?.text || part?.content || "").join("");
      }
      content = (content || "").trim();
      if (!content && message?.reasoning) content = String(message.reasoning).trim();

      if (!content) {
        fail("empty content. finish_reason:", data.choices?.[0]?.finish_reason,
          "model:", data.model, "usage:", JSON.stringify(data.usage));
        throw new Error(
          "Model returned empty content. Try a concrete instruct model " +
          "(e.g. openai/gpt-4o-mini) instead of a free/reasoning router."
        );
      }
      return content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    },

    // Parse the model's text into validated [{name, tabs:[<tabEl>]}] groups,
    // mapping indices back to real tab elements and guaranteeing each tab is
    // used at most once. Any tab the model omitted lands in a trailing "Misc".
    parseGroups(text, sourceTabs) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("Could not parse model output: " + text.slice(0, 200));
        parsed = JSON.parse(match[0]);
      }

      const used = new Set();
      const groups = [];
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
        if (members.length) groups.push({ name: group.name || "Group", tabs: members });
      }

      const missed = sourceTabs.filter((_, i) => !used.has(i));
      if (missed.length) groups.push({ name: "Misc", tabs: missed });
      return groups;
    },
  };

  // ============================================================================
  // Native Zen tab groups
  // ============================================================================
  const groups = {
    // Normalize a group name for matching existing groups across a re-tidy.
    norm(name) { return (name || "").trim().toLowerCase(); },

    // Create one fresh native group from `members`. To guarantee the new group
    // is never NESTED inside another, any member that currently lives in a
    // group is first pulled out to the top level (gBrowser.ungroupTab), so the
    // insertBefore anchor is always a top-level tab.
    create(members, label, color) {
      if (typeof gBrowser.ungroupTab === "function") {
        for (const t of members) {
          if (t.group) { try { gBrowser.ungroupTab(t); } catch (e) { debug("ungroupTab failed:", e?.message); } }
        }
      }
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
              if (label) group.label = label;
              if (color) group.color = color;
            } catch { /* non-fatal */ }
          }
          return true;
        } catch (e) {
          debug("addTabGroup attempt failed for", label, e?.message);
        }
      }
      fail("could not create group:", label);
      return false;
    },

    // Map of normalized group-name -> group element in the active workspace.
    existingByName() {
      const map = new Map();
      const section = dom.activeSection() || doc;
      for (const groupEl of section.querySelectorAll("tab-group")) {
        const key = groups.norm(groupEl.label || groupEl.getAttribute?.("label"));
        if (key && !map.has(key)) map.set(key, groupEl);
      }
      return map;
    },

    // Map of existing group-name -> color, used by the recreate() fallback.
    colorByName() {
      const map = {};
      for (const [, groupEl] of groups.existingByName()) {
        const name = (groupEl.label || groupEl.getAttribute?.("label") || "").trim();
        const color = groupEl.color || groupEl.getAttribute?.("color") || "";
        if (name && color && !(name in map)) map[name] = color;
      }
      return map;
    },

    // Can we move tabs between groups in place? (Modern Zen/Firefox.)
    canReconcile(existing) {
      for (const [, el] of existing) {
        return typeof el.addTabs === "function" && typeof gBrowser.ungroupTab === "function";
      }
      return true; // no existing groups → everything is a fresh create anyway
    },

    // Apply the model's plan. Dispatches to an in-place reconcile (preferred,
    // minimal disruption) or a flatten+rebuild fallback for older builds.
    apply(plan) {
      if (typeof gBrowser.addTabGroup !== "function") {
        throw new Error("gBrowser.addTabGroup is unavailable in this Zen build.");
      }
      const existing = groups.existingByName();
      if (groups.canReconcile(existing)) groups.reconcile(plan, existing);
      else groups.recreate(plan, groups.colorByName());
    },

    // In-place reconcile against current groups. Groups whose name survives are
    // KEPT in place (position + color preserved); only the tabs that actually
    // changed are moved. Genuinely new groups are created; groups the plan
    // abandoned empty out and dissolve. This keeps the sidebar stable when the
    // change is minor, while still letting categories broaden or reorganize.
    reconcile(plan, existing) {
      const usedColors = new Set();
      const matched = new Set();
      let colorIndex = 0;

      const pickColor = () => {
        const palette = CONFIG.grouping.colors;
        let c;
        do { c = palette[colorIndex++ % palette.length]; }
        while (usedColors.has(c) && colorIndex <= palette.length);
        return c;
      };

      for (const group of plan) {
        const live = group.tabs.filter(tabs.isAlive);
        const dropped = group.tabs.length - live.length;
        if (dropped) warn(`${group.name}: skipped ${dropped} tab(s) closed mid-tidy`);
        if (!live.length) { debug("skipping empty group:", group.name); continue; }

        const el = existing.get(groups.norm(group.name));
        if (el && typeof el.addTabs === "function") {
          // Keep this group in place; move in only the tabs not already here.
          matched.add(el);
          usedColors.add(el.color || el.getAttribute?.("color") || "");
          const toAdd = live.filter((t) => t.group !== el);
          if (toAdd.length) {
            debug(`updating group: ${group.name} (+${toAdd.length} tab(s))`);
            try { el.addTabs(toAdd); } catch (e) { warn("addTabs failed:", e); }
          }
        } else {
          const color = pickColor();
          usedColors.add(color);
          debug(`creating group: ${group.name} (${live.length} tabs, ${color})`);
          groups.create(live, group.name, color);
        }
      }

      // Any existing group the plan didn't reuse has had its tabs pulled into
      // other groups; dissolve whatever is left so it doesn't linger.
      for (const [, el] of existing) {
        if (matched.has(el)) continue;
        if (groups.hasLiveTabs(el)) {
          try { el.ungroupTabs?.(); } catch (e) { warn("ungroupTabs failed:", e); }
        }
      }
    },

    // Fallback for builds without in-place moves: flatten everything, then
    // build groups fresh, preserving colors for names that survive.
    recreate(plan, prevColors = {}) {
      groups.flattenAll();
      let colorIndex = 0;
      const usedColors = new Set();
      for (const group of plan) {
        const live = group.tabs.filter(tabs.isAlive);
        if (!live.length) continue;
        let color = prevColors[group.name];
        if (!color || usedColors.has(color)) {
          const palette = CONFIG.grouping.colors;
          do { color = palette[colorIndex++ % palette.length]; }
          while (usedColors.has(color) && colorIndex <= palette.length);
        }
        usedColors.add(color);
        groups.create(live, group.name, color);
      }
    },

    // Dissolve every existing group in the active workspace, keeping their tabs
    // (recreate() fallback only).
    flattenAll() {
      const section = dom.activeSection() || doc;
      for (const groupEl of [...section.querySelectorAll("tab-group")]) {
        try {
          if (typeof groupEl.ungroupTabs === "function") groupEl.ungroupTabs();
          else if (typeof gBrowser.ungroupTab === "function") {
            for (const t of [...(groupEl.tabs || groupEl.querySelectorAll("tab, .tabbrowser-tab"))]) {
              gBrowser.ungroupTab(t);
            }
          }
        } catch (e) {
          warn("could not flatten group:", e);
        }
      }
    },

    // Is a group element holding at least one tab that isn't closing?
    hasLiveTabs(groupEl) {
      const list = groupEl.tabs || groupEl.querySelectorAll("tab, .tabbrowser-tab");
      for (const t of list) { if (tabs.isAlive(t)) return true; }
      return false;
    },

    // Dissolve any group left empty (after a re-tidy, a close, or a manual
    // drag moved its last tab out). Scoped to the active workspace.
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
          try { groupEl.remove(); removed++; } catch { warn("could not remove empty group:", e); }
        }
      }
      if (removed) debug("removed", removed, "empty group(s)");
      return removed;
    },

    // Tab removal animates, so a single check can miss a just-emptied group.
    // Poll a few times to reliably catch the group becoming empty.
    scheduleEmptyCheck() {
      let tries = 0;
      const tick = () => {
        groups.removeEmpty();
        if (++tries < 6) setTimeout(tick, 150);
      };
      setTimeout(tick, 80);
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
        pending = setTimeout(() => { pending = null; groups.removeEmpty(); }, 500);
      });
      observer.observe(root, { childList: true, subtree: true });
      debug("empty-group watcher installed on", dom.describe(root));
    },

    // Close every tab in a group (and let the now-empty group dissolve).
    close(groupEl) {
      const members = [...groupEl.querySelectorAll("tab, .tabbrowser-tab")].filter(tabs.isAlive);
      debug("closing group:", groupEl.label, "(" + members.length + " tabs)");
      for (const tab of members) {
        try { gBrowser.removeTab(tab, { animate: true }); } catch (e) { warn("removeTab failed:", e); }
      }
      groups.scheduleEmptyCheck();
    },
  };

  // ============================================================================
  // mk — tiny DOM builders used by the modals.
  // ============================================================================
  const mk = {
    el(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    },
    field(labelText, control) {
      const wrap = mk.el("div", "zen-tidy-tabs-field");
      const label = mk.el("label", "zen-tidy-tabs-label", labelText);
      wrap.append(label, control);
      return wrap;
    },
    input(value, { type = "text", placeholder = "" } = {}) {
      const input = mk.el("input", "zen-tidy-tabs-input");
      input.type = type;
      input.value = value ?? "";
      if (placeholder) input.placeholder = placeholder;
      return input;
    },
    button(text, variant = "") {
      return mk.el("button", "zen-tidy-tabs-btn" + (variant ? " " + variant : ""), text);
    },
  };

  // ============================================================================
  // modal — a single themed overlay + panel, styled to match Zen.
  // ============================================================================
  const modal = {
    _escHandler: null,

    open(title) {
      modal.close();

      const overlay = mk.el("div", "zen-tidy-tabs-overlay");
      overlay.id = "zen-tidy-tabs-overlay";
      const panel = mk.el("div", "zen-tidy-tabs-modal");
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-label", title);

      const header = mk.el("div", "zen-tidy-tabs-modal-header");
      header.append(mk.el("div", "zen-tidy-tabs-modal-title", title));
      const closeBtn = mk.el("button", "zen-tidy-tabs-modal-close", "✕");
      closeBtn.setAttribute("aria-label", "Close");
      closeBtn.addEventListener("click", modal.close);
      header.append(closeBtn);

      const body = mk.el("div", "zen-tidy-tabs-modal-body");
      const footer = mk.el("div", "zen-tidy-tabs-modal-footer");

      panel.append(header, body, footer);
      overlay.append(panel);

      // Click outside the panel, or Escape, closes the modal.
      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) modal.close(); });
      modal._escHandler = (e) => {
        if (e.key === "Escape") { modal.close(); return; }
        // Keep Tab focus trapped inside the panel.
        if (e.key === "Tab") modal._trapTab(e, panel);
      };
      doc.addEventListener("keydown", modal._escHandler, true);

      (doc.documentElement || doc.body).appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add("open"));
      return { overlay, body, footer };
    },

    // Cycle focus among the panel's focusable elements instead of escaping to
    // the underlying chrome.
    _trapTab(e, panel) {
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
      if (modal._escHandler) {
        doc.removeEventListener("keydown", modal._escHandler, true);
        modal._escHandler = null;
      }
      doc.getElementById("zen-tidy-tabs-overlay")?.remove();
    },
  };

  // ============================================================================
  // ui — the actual modal contents (group editor + settings).
  // ============================================================================
  const ui = {
    // A reusable swatch grid bound to the 9 native group colors.
    colorPicker(initial) {
      const grid = mk.el("div", "zen-tidy-tabs-swatches");
      let selected = initial || CONFIG.grouping.colors[0];
      for (const name of CONFIG.grouping.colors) {
        const swatch = mk.el("button", "zen-tidy-tabs-swatch");
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

    // Edit one group: name + color, with a "Close group" action.
    editGroup(group) {
      const { body, footer } = modal.open("Edit group");

      const name = mk.input(group.label ?? "", { placeholder: "Group name" });
      const picker = ui.colorPicker(group.color);

      body.append(
        mk.field("Name", name),
        mk.field("Color", picker.grid)
      );

      const closeGroup = mk.button("Close group", "danger");
      closeGroup.addEventListener("click", () => { groups.close(group); modal.close(); });

      const cancel = mk.button("Cancel", "ghost");
      cancel.addEventListener("click", modal.close);

      const save = mk.button("Save changes", "primary");
      save.addEventListener("click", () => {
        const newName = name.value.trim();
        try {
          if (newName) { group.label = newName; group.setAttribute("label", newName); }
          const color = picker.get();
          group.color = color;
          group.setAttribute("color", color);
        } catch (e) { fail("could not update group:", e); }
        modal.close();
      });

      footer.append(closeGroup, mk.el("div", "zen-tidy-tabs-spacer"), cancel, save);
      name.focus();
      name.select();
    },

    // App settings: key, model, and label appearance — no about:config needed.
    settings() {
      const { body, footer } = modal.open("Zen Tidy Tabs Settings");

      const key = mk.input(prefs.apiKey(), { type: "password", placeholder: "sk-or-v1-..." });
      const model = mk.input(prefs.model(), { placeholder: CONFIG.api.defaultModel });

      // Model suggestions via a datalist.
      const listId = "zen-tidy-tabs-model-list";
      const datalist = mk.el("datalist");
      datalist.id = listId;
      for (const slug of CONFIG.api.suggestedModels) {
        const opt = mk.el("option");
        opt.value = slug;
        datalist.append(opt);
      }
      model.setAttribute("list", listId);

      // Reusable segmented control: options = [[value, text], ...].
      const makeSegment = (options, current) => {
        let value = current;
        const seg = mk.el("div", "zen-tidy-tabs-segment");
        for (const [val, text] of options) {
          const btn = mk.el("button", "zen-tidy-tabs-seg", text);
          if (val === current) btn.classList.add("active");
          btn.addEventListener("click", () => {
            value = val;
            seg.querySelectorAll(".zen-tidy-tabs-seg").forEach((s) => s.classList.remove("active"));
            btn.classList.add("active");
          });
          seg.append(btn);
        }
        return { el: seg, get: () => value };
      };

      const labelSeg = makeSegment(
        [["filled", "Colored"], ["text", "Text only"]],
        prefs.labelStyle()
      );

      const urlSeg = makeSegment(
        [["detailed", "Detailed"], ["compact", "Compact"], ["minimal", "Minimal"]],
        prefs.urlMode()
      );
      const urlHint = mk.el(
        "p", "zen-tidy-tabs-hint",
        "What each tab sends to the AI — Detailed: title + URL · Compact: title + domain · " +
        "Minimal: title only. Query strings are never sent."
      );

      const hint = mk.el("p", "zen-tidy-tabs-hint");
      hint.append(doc.createTextNode("Key is stored locally. Get one at "));
      const link = mk.el("a", "zen-tidy-tabs-link", "openrouter.ai/keys");
      link.addEventListener("click", () => win.openTrustedLinkIn?.("https://openrouter.ai/keys", "tab"));
      hint.append(link, doc.createTextNode("."));

      body.append(
        mk.field("OpenRouter API key", key),
        mk.field("Model", model),
        datalist,
        mk.field("Group labels", labelSeg.el),
        mk.field("Tab info sent to AI", urlSeg.el),
        urlHint,
        hint
      );

      const cancel = mk.button("Cancel", "ghost");
      cancel.addEventListener("click", modal.close);

      const save = mk.button("Save settings", "primary");
      save.addEventListener("click", () => {
        prefs.set(CONFIG.prefs.apiKey, key.value.trim());
        prefs.set(CONFIG.prefs.model, model.value.trim());
        prefs.set(CONFIG.prefs.labelStyle, labelSeg.get());
        prefs.set(CONFIG.prefs.urlMode, urlSeg.get());
        styles.inject(); // re-apply label appearance immediately
        modal.close();
        orchestrator.notify("Settings saved.");
      });

      footer.append(mk.el("div", "zen-tidy-tabs-spacer"), cancel, save);
      key.focus();
    },
  };

  // ============================================================================
  // UI — the Tidy control (a hover-reveal twin of Zen's Clear button)
  // ============================================================================
  const control = {
    // Build the control. When `twinOf` (the Clear button) is given, clone its
    // element type and classes so it inherits Clear's look + hover behavior.
    // Clear may show its text via a `label` attribute (XUL) rather than text
    // content, so we set both.
    build(twinOf) {
      const el = doc.createElement(twinOf ? twinOf.tagName : "span");
      el.id = CONFIG.ui.controlId;
      el.textContent = CONFIG.ui.label;
      el.setAttribute("label", CONFIG.ui.label); // for XUL toolbarbutton twins
      el.setAttribute("tooltiptext", "Tidy tabs with AI");
      el.title = "Tidy tabs with AI";
      el.className = twinOf ? twinOf.className : "zen-tidy-tabs-fallback";
      if (twinOf) el.dataset.twin = "1";

      const onTidy = (e) => { e.preventDefault(); e.stopPropagation(); orchestrator.runTidy(); };
      el.addEventListener("click", onTidy);
      el.addEventListener("command", onTidy); // XUL buttons fire command
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
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
      log("control mounted: twin of Clear (" + dom.describe(clear) + ")");
      return true;
    },

    // Some builds only add the Clear control to the DOM while the separator is
    // hovered. Watch for that and place the twin the moment Clear appears; the
    // watcher stays installed so the twin is re-created if Zen rebuilds the row.
    installClearWatcher() {
      if (win.__zenTidyTabsClearWatcher) return;
      win.__zenTidyTabsClearWatcher = true;
      // Hover anywhere in the chrome: cheap because placeTwinIfClearPresent
      // early-returns once a twin exists.
      const target = doc.documentElement;
      target.addEventListener("mouseover", () => control.placeTwinIfClearPresent(), true);
      debug("clear watcher installed on", dom.describe(target));
    },

    // Mount strategy:
    //   1. twin beside Clear if it's already present;
    //   2. else a hover-reveal control on the separator (so something works now);
    //   3. always install the hover watcher to upgrade to a twin when Clear shows.
    mount() {
      control.installClearWatcher();

      if (control.placeTwinIfClearPresent()) return true;

      if (!doc.getElementById(CONFIG.ui.controlId)) {
        const section = dom.activeSection();
        const anchor = section && dom.firstNormalNode(section);
        if (anchor?.parentElement) {
          anchor.parentElement.insertBefore(control.build(null), anchor);
          log("control mounted: separator fallback (hover to reveal; will upgrade to twin)");
          return true;
        }
      }

      debug("no mount target yet (will retry / wait for hover)");
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
  // UI — group label editing.
  //   single click (settled for 300ms) → inline rename
  //   double click (2nd click within 300ms) → full edit modal (name + color)
  // A debounce disambiguates the two so a double-click never leaves the label
  // stuck in the inline-edit state.
  // ============================================================================
  const editor = {
    _clickTimer: null,
    _editing: null, // { labelEl, group, original, cleanup }

    install() {
      if (win.__zenTidyTabsEditorInstalled) return;
      win.__zenTidyTabsEditorInstalled = true;

      doc.addEventListener(
        "click",
        (e) => {
          const labelEl = e.target?.closest?.(".tab-group-label");
          if (!labelEl) return;
          const group = labelEl.closest("tab-group");
          if (!group) return;

          // Already editing this label? Let the click position the caret.
          if (editor._editing && editor._editing.labelEl === labelEl) return;

          // We own this interaction: block Zen's native click (collapse / its
          // own inline edit) so single vs double is decided here.
          e.preventDefault();
          e.stopPropagation();

          if (editor._clickTimer) {
            clearTimeout(editor._clickTimer);
            editor._clickTimer = null;
            editor.cancelInline();
            if (!doc.getElementById("zen-tidy-tabs-overlay")) ui.editGroup(group);
            return;
          }
          editor._clickTimer = setTimeout(() => {
            editor._clickTimer = null;
            editor.startInline(group, labelEl);
          }, 300);
        },
        true // capture, so we act before the label's own handler
      );
      debug("group editor installed (click to rename, double-click for options)");
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
        const sel = win.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch { /* selection not critical */ }

      const commit = () => {
        const name = (labelEl.textContent || "").trim();
        editor.finishInline();
        if (name && name !== original) {
          try { group.label = name; group.setAttribute("label", name); }
          catch (e) { fail("could not rename group:", e); labelEl.textContent = original; }
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
      editor._editing = {
        labelEl,
        group,
        original,
        cleanup: () => labelEl.removeEventListener("keydown", onKey, true),
      };
    },

    finishInline() {
      const e = editor._editing;
      if (!e) return;
      editor._editing = null;
      e.cleanup?.();
      e.labelEl.removeAttribute("contenteditable");
      e.labelEl.classList.remove("zen-tidy-tabs-inline-editing");
    },

    // Abandon an in-progress inline edit, restoring the original name.
    cancelInline() {
      const e = editor._editing;
      if (!e) return;
      e.labelEl.textContent = e.original;
      editor.finishInline();
    },
  };

  // ============================================================================
  // Styles — only our control; groups keep Zen's native appearance.
  // ============================================================================
  const styles = {
    // CSS variables resolved against Zen's palette, with sane dark fallbacks.
    vars: {
      bg: "var(--zen-main-browser-background, #1f1e25)",
      elevated: "var(--zen-colors-tertiary, #2a2833)",
      border: "var(--zen-colors-border, #3a3845)",
      text: "var(--zen-primary-color, #ECECEC)",
      muted: "#9b99a6",
      accent: "var(--zen-primary-color, #6c5ce7)",
    },

    // Text-only labels: Arc-style. Drop the colored background entirely and
    // render the name in a neutral, theme-aware color with a bold weight, so
    // labels never clash with the Zen theme (too dark / too bright). Empty when
    // the user keeps the default "filled" style.
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
      const v = styles.vars;
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
          color: ${v.accent} !important;
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
          background: ${v.bg};
          color: ${v.text};
          border: 1px solid ${v.border};
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
          all: unset; cursor: pointer; color: ${v.muted};
          width: 22px; height: 22px; border-radius: 6px; text-align: center;
        }
        .zen-tidy-tabs-modal-close:hover { background: ${v.elevated}; color: ${v.text}; }
        .zen-tidy-tabs-modal-body { padding: 4px 16px 8px; display: flex; flex-direction: column; gap: 14px; }
        .zen-tidy-tabs-modal-footer {
          display: flex; align-items: center; gap: 8px;
          padding: 12px 16px 16px;
        }
        .zen-tidy-tabs-spacer { flex: 1; }

        .zen-tidy-tabs-field { display: flex; flex-direction: column; gap: 6px; }
        .zen-tidy-tabs-label { font-size: 11px; color: ${v.muted}; font-weight: 600; }
        .zen-tidy-tabs-input {
          all: unset; box-sizing: border-box; width: 100%;
          padding: 8px 10px; font-size: 13px;
          color: ${v.text};
          background: ${v.elevated};
          border: 1px solid ${v.border}; border-radius: 9px;
        }
        .zen-tidy-tabs-input:focus-within, .zen-tidy-tabs-input:focus {
          border-color: ${v.accent};
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
          box-shadow: 0 0 0 2px ${v.bg}, 0 0 0 4px var(--swatch);
        }

        /* ---- Segmented control ---- */
        .zen-tidy-tabs-segment {
          display: inline-flex; flex-wrap: wrap; padding: 3px; gap: 3px;
          background: ${v.elevated}; border: 1px solid ${v.border};
          border-radius: 10px;
        }
        .zen-tidy-tabs-seg {
          all: unset; cursor: pointer; padding: 5px 12px; font-size: 12px;
          color: ${v.muted}; border-radius: 7px; text-align: center;
        }
        .zen-tidy-tabs-seg.active { background: ${v.accent}; color: #fff; }

        .zen-tidy-tabs-hint { margin: 2px 0 0; font-size: 11px; color: ${v.muted}; }
        .zen-tidy-tabs-link { color: ${v.accent}; cursor: pointer; text-decoration: underline; }

        /* ---- Buttons ---- */
        .zen-tidy-tabs-btn {
          all: unset; cursor: pointer; padding: 7px 14px; font-size: 13px; font-weight: 600;
          border-radius: 9px; color: ${v.text}; background: ${v.elevated};
          border: 1px solid ${v.border}; text-align: center;
        }
        .zen-tidy-tabs-btn:hover { filter: brightness(1.12); }
        .zen-tidy-tabs-btn.primary { background: ${v.accent}; border-color: transparent; color: #fff; }
        .zen-tidy-tabs-btn.ghost { background: transparent; }
        .zen-tidy-tabs-btn.danger { background: transparent; border-color: transparent; color: #e26d6d; }
        .zen-tidy-tabs-btn.danger:hover { background: rgba(226,109,109,.14); filter: none; }

        /* ---- Inline group rename ---- */
        .tab-group-label.zen-tidy-tabs-inline-editing {
          outline: 1px solid ${v.accent} !important;
          outline-offset: 1px;
          border-radius: 5px;
          cursor: text;
          -moz-user-select: text;
          user-select: text;
        }

        ${styles.labelStyleCss()}
      `;
      (doc.head || doc.documentElement).appendChild(style);
      debug("styles injected (labelStyle:", prefs.labelStyle() + ")");
    },
  };

  // ============================================================================
  // Orchestration
  // ============================================================================
  const orchestrator = {
    running: false,

    notify(message, isError = false) {
      (isError ? fail : log)(message);
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
        }, 6000);
      } catch {
        /* notification box not available — console log already happened */
      }
    },

    async runTidy() {
      if (orchestrator.running) { debug("tidy already running"); return; }

      const apiKey = prefs.apiKey();
      if (!apiKey) {
        orchestrator.notify("Set your key in about:config → " + CONFIG.prefs.apiKey, true);
        return;
      }

      // Re-tidy considers the ENTIRE workspace, not just new tabs.
      const sourceTabs = tabs.collect(true);
      if (sourceTabs.length < CONFIG.grouping.minTabs) {
        orchestrator.notify(`Need at least ${CONFIG.grouping.minTabs} tabs to tidy.`, true);
        return;
      }

      orchestrator.running = true;
      control.setBusy(true);
      try {
        log(`tidying ${sourceTabs.length} tabs`);
        const data = await ai.request(tabs.snapshot(sourceTabs), apiKey, prefs.model());
        const plan = ai.parseGroups(ai.extractText(data), sourceTabs);
        log("plan:", plan.map((g) => `${g.name}(${g.tabs.length})`).join(", "));

        // apply() reconciles against existing groups in place: groups that
        // survive keep their position + color, only changed tabs move, and
        // abandoned groups dissolve. No nesting, minimal disruption.
        groups.apply(plan);
        groups.scheduleEmptyCheck();
        orchestrator.notify(`Sorted ${sourceTabs.length} tabs into ${plan.length} groups.`);
      } catch (e) {
        orchestrator.notify("failed: " + (e.message || e), true);
        fail(e);
      } finally {
        orchestrator.running = false;
        control.setBusy(false);
      }
    },
  };

  // ============================================================================
  // diag — one-shot DOM diagnostics. Reveals what "Clear" actually is and how
  // the sidebar is laid out, so placement can be targeted precisely.
  // ============================================================================
  const diag = {
    pseudo(el, which) {
      try { return win.getComputedStyle(el, which).content || ""; } catch { return ""; }
    },

    path(el, depth = 8) {
      const parts = [];
      let cur = el;
      for (let i = 0; cur && i < depth; i++) { parts.unshift(dom.describe(cur)); cur = cur.parentElement; }
      return parts.join(" > ");
    },

    // Every element anywhere whose text / label / tooltip / pseudo says "clear".
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
      log("================= DOM DIAGNOSIS =================");

      const sel = gBrowser.selectedTab;
      log("selectedTab:", dom.describe(sel));
      log("  ancestry:", diag.path(sel));

      const section = dom.activeSection();
      log("activeSection:", dom.describe(section));
      if (section) {
        log("  children:", [...section.children].map((c) => dom.describe(c)).join("  |  "));
      }
      log("firstNormalNode:", section ? dom.describe(dom.firstNormalNode(section)) : "n/a");

      const clearViaMatcher = dom.clearControl();
      log("clearControl() result:", dom.describe(clearViaMatcher));

      const hits = diag.clearCandidates();
      log("'clear' candidates found:", hits.length);
      hits.slice(0, 12).forEach((h, i) => {
        log(`  [${i}] ${dom.describe(h.el)}`);
        log(`       text="${h.text.slice(0, 24)}" label="${h.label}" tip="${h.tip}" pseudo=${JSON.stringify(h.pseudo).slice(0, 40)}`);
        log(`       path: ${diag.path(h.el, 6)}`);
      });

      const newTab = diag.newTabButton();
      log("newTab button:", dom.describe(newTab));
      if (newTab?.parentElement) {
        log("  newTab siblings:", [...newTab.parentElement.children].map((c) => dom.describe(c)).join("  |  "));
        log("  newTab parent path:", diag.path(newTab.parentElement, 6));
      }

      log("================ END DIAGNOSIS =================");
    },
  };

  // ============================================================================
  // Init — mount the control (polling until the sidebar DOM exists), inject
  // styles, and install the group editor.
  // ============================================================================
  const init = () => {
    log("init — Zen Tidy Tabs loading");
    debug("location:", (() => { try { return location.href; } catch { return "?"; } })());
    debug("addTabGroup:", typeof gBrowser.addTabGroup, "| tabs:", gBrowser.tabs.length);

    styles.inject();
    editor.install();
    groups.installEmptyWatcher();
    if (CONFIG.debug) diag.run();

    if (!control.mount()) {
      let attempts = 0;
      const timer = setInterval(() => {
        if (control.mount() || ++attempts > 40) {
          clearInterval(timer);
          if (!doc.getElementById(CONFIG.ui.controlId)) {
            log("control not placed yet — it will appear when you hover the tab separator");
          }
        }
      }, 250);
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
    log("ready — Tidy: click | Settings: right-click the Tidy control");
  };

  init();
})();
