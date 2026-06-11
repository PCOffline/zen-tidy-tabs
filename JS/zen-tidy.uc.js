// ==UserScript==
// @name           Zen Tidy
// @description    Arc-style AI tab tidying integrated into Zen's native sidebar.
//                 Adds a hover-reveal "Tidy" control next to Zen's Clear button.
//                 Clicking it asks an LLM (via OpenRouter) to cluster the open
//                 tabs, then builds native Zen tab groups. Double-click a group
//                 label to rename / recolor it.
// @author         you
// @include        main
// ==/UserScript==

(() => {
  "use strict";

  // ============================================================================
  // Configuration — everything tweakable lives here.
  // ============================================================================
  const CONFIG = {
    debug: true,

    prefs: {
      apiKey: "extensions.zentidy.apikey",     // OpenRouter key (sk-or-v1-...)
      model: "extensions.zentidy.model",        // optional model slug override
      labelStyle: "extensions.zentidy.labelstyle", // "filled" | "text"
    },
    api: {
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      defaultModel: "openai/gpt-4o-mini",
      maxTokens: 2048,
      // Sent as OpenRouter attribution headers.
      referer: "https://github.com/zen-tidy",
      title: "Zen Tidy",
      // Offered as quick suggestions in the settings modal.
      suggestedModels: [
        "openai/gpt-4o-mini",
        "openai/gpt-4.1-mini",
        "google/gemini-flash-1.5",
        "anthropic/claude-3.5-haiku",
      ],
    },

    ui: {
      controlId: "zen-tidy-button",
      styleId: "zen-tidy-style",
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
  const PREFIX = "[Zen Tidy]";
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
    url(t) { return (t.linkedBrowser?.currentURI?.spec || "").slice(0, CONFIG.snapshot.urlMax); },

    // Compact [{i, title, url}] list for the model.
    snapshot(list) {
      return list.map((t, i) => ({ i, title: tabs.title(t), url: tabs.url(t) }));
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
      return [
        `You are "Tidy", an engine that organizes a browser sidebar's open tabs`,
        `into a small set of clean, intuitive groups — like Arc's "Tidy Tabs".`,
        ``,
        `## Input`,
        `${n} tabs, each {"i": <index 0-${lastIndex}>, "title": <string>, "url": <string>}:`,
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
        ``,
        `## Avoid`,
        `- A vague mega-group like "Web", "Other", or "Misc" holding most tabs.`,
        `- Many one-tab groups when those tabs share an obvious theme.`,
        `- Two different groups that mean the same thing.`,
        ``,
        `## Naming`,
        `- 1-3 words, Title Case, human-readable. No emojis, no quotes.`,
        `- Name the shared theme, not a list of the items.`,
        ``,
        `## Hard constraints (must all hold)`,
        `1. Produce between 2 and 8 groups.`,
        `2. Every index 0-${lastIndex} appears in EXACTLY ONE group.`,
        `   Never skip an index, never repeat one, never invent one out of range.`,
        `3. Output ONLY a single JSON object: no prose, no markdown, no code`,
        `   fences, nothing before or after it.`,
        ``,
        `## Output schema`,
        `{"groups":[{"name":"<Title Case label>","tabs":[<indices>]}]}`,
        ``,
        `## Example`,
        `Input: [{"i":0,"title":"Horses - Wynncraft Wiki"},{"i":1,"title":"Wynncraft Market"},{"i":2,"title":"Best Beef Chili Recipe"},{"i":3,"title":"Van Gogh Mouse Pad - AliExpress"},{"i":4,"title":"Monet Mouse Pad - AliExpress"}]`,
        `Output: {"groups":[{"name":"Wynncraft","tabs":[0,1]},{"name":"Mouse Pad Shopping","tabs":[3,4]},{"name":"Recipes","tabs":[2]}]}`,
        ``,
        `Before answering, check that every index 0-${lastIndex} is used exactly`,
        `once. Then output only the JSON object.`,
      ].join("\n");
    },

    async request(snapshot, apiKey, model) {
      const body = {
        model,
        max_tokens: CONFIG.api.maxTokens,
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

      debug("calling OpenRouter, model:", model);
      const res = await fetch(CONFIG.api.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + apiKey,
          "HTTP-Referer": CONFIG.api.referer,
          "X-Title": CONFIG.api.title,
        },
        body: JSON.stringify(body),
      });

      debug("API responded HTTP", res.status);
      if (!res.ok) {
        throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
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
      return content.replace(/```json|```/g, "").trim();
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
      for (const group of parsed.groups || []) {
        const members = [];
        for (const index of group.tabs || []) {
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
    // Create one native group. Zen's addTabGroup dereferences `insertBefore`,
    // so we always pass an anchor tab. Different builds expect slightly
    // different option shapes, hence the staged fallbacks.
    create(members, label, color) {
      const anchor = members[0];
      const attempts = [
        { label, color, insertBefore: anchor },
        { label, color },
        { id: label, color, label, insertBefore: anchor, isUserTriggered: true },
      ];
      for (const options of attempts) {
        try {
          gBrowser.addTabGroup(members, options);
          return true;
        } catch (e) {
          debug("addTabGroup attempt failed for", label, e?.message);
        }
      }
      fail("could not create group:", label);
      return false;
    },

    // Build every group, skipping tabs closed mid-tidy and empty groups.
    apply(plan) {
      if (typeof gBrowser.addTabGroup !== "function") {
        throw new Error("gBrowser.addTabGroup is unavailable in this Zen build.");
      }
      let colorIndex = 0;
      for (const group of plan) {
        const live = group.tabs.filter(tabs.isAlive);
        const dropped = group.tabs.length - live.length;
        if (dropped) warn(`${group.name}: skipped ${dropped} tab(s) closed mid-tidy`);
        if (!live.length) { debug("skipping empty group:", group.name); continue; }

        const color = CONFIG.grouping.colors[colorIndex++ % CONFIG.grouping.colors.length];
        debug(`creating group: ${group.name} (${live.length} tabs, ${color})`);
        groups.create(live, group.name, color);
      }
    },

    // Dissolve any group left empty after a re-tidy moved its tabs elsewhere.
    removeEmpty() {
      let removed = 0;
      for (const groupEl of doc.querySelectorAll("tab-group")) {
        if (groupEl.querySelector("tab, .tabbrowser-tab")) continue;
        try {
          if (typeof groupEl.ungroup === "function") groupEl.ungroup();
          else if (typeof gBrowser.removeTabGroup === "function") gBrowser.removeTabGroup(groupEl);
          else groupEl.remove();
          removed++;
        } catch (e) {
          warn("could not remove empty group:", e);
        }
      }
      if (removed) debug("removed", removed, "empty group(s)");
    },

    // Close every tab in a group (and let the now-empty group dissolve).
    close(groupEl) {
      const members = [...groupEl.querySelectorAll("tab, .tabbrowser-tab")].filter(tabs.isAlive);
      debug("closing group:", groupEl.label, "(" + members.length + " tabs)");
      for (const tab of members) {
        try { gBrowser.removeTab(tab, { animate: true }); } catch (e) { warn("removeTab failed:", e); }
      }
      setTimeout(() => groups.removeEmpty(), 60);
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
      const wrap = mk.el("div", "zentidy-field");
      const label = mk.el("label", "zentidy-label", labelText);
      wrap.append(label, control);
      return wrap;
    },
    input(value, { type = "text", placeholder = "" } = {}) {
      const input = mk.el("input", "zentidy-input");
      input.type = type;
      input.value = value ?? "";
      if (placeholder) input.placeholder = placeholder;
      return input;
    },
    button(text, variant = "") {
      return mk.el("button", "zentidy-btn" + (variant ? " " + variant : ""), text);
    },
  };

  // ============================================================================
  // modal — a single themed overlay + panel, styled to match Zen.
  // ============================================================================
  const modal = {
    _escHandler: null,

    open(title) {
      modal.close();

      const overlay = mk.el("div", "zentidy-overlay");
      overlay.id = "zentidy-overlay";
      const panel = mk.el("div", "zentidy-modal");

      const header = mk.el("div", "zentidy-modal-header");
      header.append(mk.el("div", "zentidy-modal-title", title));
      const closeBtn = mk.el("button", "zentidy-modal-close", "✕");
      closeBtn.addEventListener("click", modal.close);
      header.append(closeBtn);

      const body = mk.el("div", "zentidy-modal-body");
      const footer = mk.el("div", "zentidy-modal-footer");

      panel.append(header, body, footer);
      overlay.append(panel);

      // Click outside the panel, or Escape, closes the modal.
      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) modal.close(); });
      modal._escHandler = (e) => { if (e.key === "Escape") modal.close(); };
      doc.addEventListener("keydown", modal._escHandler, true);

      (doc.documentElement || doc.body).appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add("open"));
      return { overlay, body, footer };
    },

    close() {
      if (modal._escHandler) {
        doc.removeEventListener("keydown", modal._escHandler, true);
        modal._escHandler = null;
      }
      doc.getElementById("zentidy-overlay")?.remove();
    },
  };

  // ============================================================================
  // ui — the actual modal contents (group editor + settings).
  // ============================================================================
  const ui = {
    // A reusable swatch grid bound to the 9 native group colors.
    colorPicker(initial) {
      const grid = mk.el("div", "zentidy-swatches");
      let selected = initial || CONFIG.grouping.colors[0];
      for (const name of CONFIG.grouping.colors) {
        const swatch = mk.el("button", "zentidy-swatch");
        swatch.style.setProperty("--swatch", CONFIG.ui.swatchHex[name]);
        swatch.title = name;
        if (name === selected) swatch.classList.add("selected");
        swatch.addEventListener("click", () => {
          selected = name;
          grid.querySelectorAll(".zentidy-swatch").forEach((s) => s.classList.remove("selected"));
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

      footer.append(closeGroup, mk.el("div", "zentidy-spacer"), cancel, save);
      name.focus();
      name.select();
    },

    // App settings: key, model, and label appearance — no about:config needed.
    settings() {
      const { body, footer } = modal.open("Tidy settings");

      const key = mk.input(prefs.apiKey(), { type: "password", placeholder: "sk-or-v1-..." });
      const model = mk.input(prefs.model(), { placeholder: CONFIG.api.defaultModel });

      // Model suggestions via a datalist.
      const listId = "zentidy-model-list";
      const datalist = mk.el("datalist");
      datalist.id = listId;
      for (const slug of CONFIG.api.suggestedModels) {
        const opt = mk.el("option");
        opt.value = slug;
        datalist.append(opt);
      }
      model.setAttribute("list", listId);

      // Segmented control for label appearance.
      let labelStyle = prefs.labelStyle();
      const segment = mk.el("div", "zentidy-segment");
      const makeSeg = (value, text) => {
        const seg = mk.el("button", "zentidy-seg", text);
        if (value === labelStyle) seg.classList.add("active");
        seg.addEventListener("click", () => {
          labelStyle = value;
          segment.querySelectorAll(".zentidy-seg").forEach((s) => s.classList.remove("active"));
          seg.classList.add("active");
        });
        return seg;
      };
      segment.append(makeSeg("filled", "Colored"), makeSeg("text", "Text only"));

      const hint = mk.el("p", "zentidy-hint");
      hint.append(doc.createTextNode("Key is stored locally. Get one at "));
      const link = mk.el("a", "zentidy-link", "openrouter.ai/keys");
      link.addEventListener("click", () => win.openTrustedLinkIn?.("https://openrouter.ai/keys", "tab"));
      hint.append(link, doc.createTextNode("."));

      body.append(
        mk.field("OpenRouter API key", key),
        mk.field("Model", model),
        datalist,
        mk.field("Group labels", segment),
        hint
      );

      const cancel = mk.button("Cancel", "ghost");
      cancel.addEventListener("click", modal.close);

      const save = mk.button("Save settings", "primary");
      save.addEventListener("click", () => {
        prefs.set(CONFIG.prefs.apiKey, key.value.trim());
        prefs.set(CONFIG.prefs.model, model.value.trim());
        prefs.set(CONFIG.prefs.labelStyle, labelStyle);
        styles.inject(); // re-apply label appearance immediately
        modal.close();
        orchestrator.notify("Settings saved.");
      });

      footer.append(mk.el("div", "zentidy-spacer"), cancel, save);
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
      el.className = twinOf ? twinOf.className : "zen-tidy-fallback";
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
      if (win.__zenTidyClearWatcher) return;
      win.__zenTidyClearWatcher = true;
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
  // UI — double-click a group label to rename + recolor
  // ============================================================================
  const editor = {
    install() {
      if (win.__zenTidyEditorInstalled) return;
      win.__zenTidyEditorInstalled = true;

      doc.addEventListener(
        "dblclick",
        (e) => {
          const group = dom.groupFromEvent(e.target);
          if (!group) return;
          e.preventDefault();
          e.stopPropagation();
          ui.editGroup(group);
        },
        true // capture, so we act before the label's collapse handler
      );
      debug("group editor installed (double-click a group label)");
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

    // Text-only labels: drop the filled background, show the name in the
    // group's color. Empty when the user keeps the default "filled" style.
    labelStyleCss() {
      if (prefs.labelStyle() !== "text") return "";
      return `
        .tab-group-label {
          background: transparent !important;
          color: var(--tab-group-color, currentColor) !important;
          font-weight: 600 !important;
          text-shadow: none !important;
        }
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
        #${CONFIG.ui.controlId}.zen-tidy-fallback {
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
        .zen-workspace-tabs-section:hover #${CONFIG.ui.controlId}.zen-tidy-fallback { opacity: .85; }
        #${CONFIG.ui.controlId}.zen-tidy-fallback:hover { opacity: 1; }

        /* ---- Modal ---- */
        .zentidy-overlay {
          position: fixed; inset: 0; z-index: 2147483647;
          display: flex; align-items: center; justify-content: center;
          background: rgba(0,0,0,.45);
          -moz-window-dragging: no-drag;
          opacity: 0; transition: opacity .14s ease;
        }
        .zentidy-overlay.open { opacity: 1; }
        .zentidy-modal {
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
        .zentidy-overlay.open .zentidy-modal { transform: none; }
        .zentidy-modal-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 16px 10px;
        }
        .zentidy-modal-title { font-size: 14px; font-weight: 600; }
        .zentidy-modal-close {
          all: unset; cursor: pointer; color: ${v.muted};
          width: 22px; height: 22px; border-radius: 6px; text-align: center;
        }
        .zentidy-modal-close:hover { background: ${v.elevated}; color: ${v.text}; }
        .zentidy-modal-body { padding: 4px 16px 8px; display: flex; flex-direction: column; gap: 14px; }
        .zentidy-modal-footer {
          display: flex; align-items: center; gap: 8px;
          padding: 12px 16px 16px;
        }
        .zentidy-spacer { flex: 1; }

        .zentidy-field { display: flex; flex-direction: column; gap: 6px; }
        .zentidy-label { font-size: 11px; color: ${v.muted}; font-weight: 600; }
        .zentidy-input {
          all: unset; box-sizing: border-box; width: 100%;
          padding: 8px 10px; font-size: 13px;
          color: ${v.text};
          background: ${v.elevated};
          border: 1px solid ${v.border}; border-radius: 9px;
        }
        .zentidy-input:focus-within, .zentidy-input:focus {
          border-color: ${v.accent};
        }

        /* ---- Color swatches (the 9 native group colors) ---- */
        .zentidy-swatches { display: flex; flex-wrap: wrap; gap: 10px; padding: 2px 0; }
        .zentidy-swatch {
          all: unset; cursor: pointer;
          width: 26px; height: 26px; border-radius: 50%;
          background: var(--swatch);
          box-shadow: 0 0 0 2px transparent, 0 1px 3px rgba(0,0,0,.3);
          transition: box-shadow .12s ease, transform .12s ease;
        }
        .zentidy-swatch:hover { transform: scale(1.08); }
        .zentidy-swatch.selected {
          box-shadow: 0 0 0 2px ${v.bg}, 0 0 0 4px var(--swatch);
        }

        /* ---- Segmented control ---- */
        .zentidy-segment {
          display: inline-flex; padding: 3px; gap: 3px;
          background: ${v.elevated}; border: 1px solid ${v.border};
          border-radius: 10px;
        }
        .zentidy-seg {
          all: unset; cursor: pointer; padding: 5px 12px; font-size: 12px;
          color: ${v.muted}; border-radius: 7px; text-align: center;
        }
        .zentidy-seg.active { background: ${v.accent}; color: #fff; }

        .zentidy-hint { margin: 2px 0 0; font-size: 11px; color: ${v.muted}; }
        .zentidy-link { color: ${v.accent}; cursor: pointer; text-decoration: underline; }

        /* ---- Buttons ---- */
        .zentidy-btn {
          all: unset; cursor: pointer; padding: 7px 14px; font-size: 13px; font-weight: 600;
          border-radius: 9px; color: ${v.text}; background: ${v.elevated};
          border: 1px solid ${v.border}; text-align: center;
        }
        .zentidy-btn:hover { filter: brightness(1.12); }
        .zentidy-btn.primary { background: ${v.accent}; border-color: transparent; color: #fff; }
        .zentidy-btn.ghost { background: transparent; }
        .zentidy-btn.danger { background: transparent; border-color: transparent; color: #e26d6d; }
        .zentidy-btn.danger:hover { background: rgba(226,109,109,.14); filter: none; }

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
          "zen-tidy-msg",
          {
            label: "Zen Tidy: " + message,
            priority: isError ? box.PRIORITY_WARNING_HIGH : box.PRIORITY_INFO_LOW,
          },
          []
        );
        setTimeout(() => {
          const note = box.getNotificationWithValue?.("zen-tidy-msg");
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

        groups.apply(plan);
        groups.removeEmpty();
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
    log("init — Zen Tidy loading");
    debug("location:", (() => { try { return location.href; } catch { return "?"; } })());
    debug("addTabGroup:", typeof gBrowser.addTabGroup, "| tabs:", gBrowser.tabs.length);

    styles.inject();
    editor.install();
    diag.run();

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
    win.zenTidy = {
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
