// @ts-check
const fs = require("fs");
const path = require("path");
const { Builder, By, Key, until } = require("selenium-webdriver");
const firefox = require("selenium-webdriver/firefox");
const S = require("./selectors");

/** Absolute path to the userChrome script under test. */
const SCRIPT_PATH = path.resolve(__dirname, "..", "..", "index.uc.js");

/** Path to the Zen executable. Override with the ZEN_BINARY env var. */
const ZEN_BINARY =
  process.env.ZEN_BINARY || "C:\\Program Files\\Zen Browser\\zen.exe";

/** Dummy key so orchestrator.runTidy() doesn't bail before reaching fetch(). */
const STUB_API_KEY = "sk-or-v1-zen-tidy-tabs-test-key";

/**
 * Drives a real Zen browser in Marionette **chrome context** (the browser
 * chrome / sidebar, where this userscript lives), exposing high-level helpers
 * the specs use. Everything runs against the actual injected script.
 */
class ZenDriver {
  /** @param {import("selenium-webdriver").WebDriver} driver */
  constructor(driver) {
    this.driver = driver;
    this.By = By;
    this.Key = Key;
    this.until = until;
  }

  static get binaryPath() {
    return ZEN_BINARY;
  }

  /** Launch Zen, switch to chrome context, inject the script, wait for mount. */
  static async launch() {
    if (!fs.existsSync(ZEN_BINARY)) {
      throw new Error(
        `Zen executable not found at "${ZEN_BINARY}". ` +
          `Set the ZEN_BINARY env var to your zen.exe path.`
      );
    }

    const options = new firefox.Options();
    options.setBinary(ZEN_BINARY);
    // Force a brand-new instance on its own (Selenium-managed) profile so we
    // never touch the user's real profile or attach to a running Zen.
    options.addArguments("-no-remote");
    // Required by recent Marionette to allow chrome-context system access
    // (driver.setContext(CHROME) + privileged executeScript).
    options.addArguments("-remote-allow-system-access");
    if (process.env.ZEN_HEADLESS === "1") {
      // NOTE: headless Firefox still exposes the chrome DOM, but elements report
      // as not-displayed, so real clicks fail. Helpers fall back to dispatched
      // events, but headed mode is recommended.
      options.addArguments("-headless");
    }
    options.setPreference("devtools.chrome.enabled", true);
    options.setPreference("browser.shell.checkDefaultBrowser", false);
    options.setPreference("browser.aboutwelcome.enabled", false);
    options.setPreference("datareporting.policy.dataSubmissionEnabled", false);
    options.setPreference("app.update.enabled", false);
    options.setPreference("app.update.auto", false);
    // Pre-seed the API key so runTidy() reaches the (stubbed) network call.
    options.setPreference(S.prefs.apiKey, STUB_API_KEY);

    // Selenium Manager probes the Zen binary, which reports a bogus Firefox
    // version (e.g. "1"), so it can't auto-resolve a matching geckodriver.
    // Resolve geckodriver ourselves and hand it to the Builder via a
    // ServiceBuilder, which bypasses Selenium Manager entirely.
    const geckodriverPath = await resolveGeckodriver();
    const service = new firefox.ServiceBuilder(geckodriverPath);

    const driver = await new Builder()
      .forBrowser("firefox")
      .setFirefoxOptions(options)
      .setFirefoxService(service)
      .build();

    const zen = new ZenDriver(driver);
    // selenium-webdriver/firefox sets context via the firefox driver; reach it
    // through the generic command interface so this stays version-tolerant.
    await driver.setContext(firefox.Context.CHROME);
    await zen._waitForBrowser();
    await zen.injectScript();
    await zen.waitForButton();
    return zen;
  }

  async quit() {
    try {
      await this.driver.quit();
    } catch {
      /* already gone */
    }
  }

  // ---- low-level chrome-context exec -------------------------------------

  /**
   * Run a script in the chrome window. The body is wrapped in a function by
   * Marionette, so use `return` to produce a value and `arguments[i]` for args.
   * @param {string} script
   * @param {...any} args
   */
  exec(script, ...args) {
    return this.driver.executeScript(script, ...args);
  }

  byId(id) {
    return this.driver.findElement(By.id(id));
  }

  $(css) {
    return this.driver.findElement(By.css(css));
  }

  actions() {
    return this.driver.actions({ async: true });
  }

  async _waitForBrowser() {
    await this.driver.wait(
      async () =>
        (await this.exec(
          "return !!(window.gBrowser && gBrowser.tabs && typeof gBrowser.tabs.length === 'number');"
        )) === true,
      30_000,
      "gBrowser was not ready in the chrome window",
      300
    );
  }

  /** Inject the full userChrome script (its IIFE auto-runs init()). */
  async injectScript() {
    const scriptText = fs.readFileSync(SCRIPT_PATH, "utf8");
    await this.exec(scriptText);
  }

  // ---- mounting / button -------------------------------------------------

  /** Wait until the Tidy control is in the DOM, nudging mount()/hover. */
  async waitForButton() {
    await this.driver.wait(
      async () => {
        const present = await this.exec(
          `return !!document.getElementById(${json(S.buttonId)});`
        );
        if (present) return true;
        // Nudge: re-run mount() and fire a chrome-wide mouseover so the Clear
        // watcher gets a chance to place the twin.
        await this.exec(
          `try { window[${json(S.globalApi)}] && window[${json(
            S.globalApi
          )}].mount(); } catch (e) {}
           document.documentElement.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
           return true;`
        );
        return false;
      },
      15_000,
      "Tidy control never mounted",
      400
    );
  }

  /** @returns {Promise<boolean>} */
  buttonExists() {
    return this.exec(
      `return !!document.getElementById(${json(S.buttonId)});`
    );
  }

  /**
   * Inspect where the Tidy control sits relative to Zen's Clear control.
   * @returns {Promise<{
   *   exists: boolean, isTwin?: boolean, hasClear?: boolean,
   *   sameParentAsClear?: boolean|null, immediatelyBeforeClear?: boolean|null,
   *   inActiveSection?: boolean
   * }>}
   */
  getButtonPlacement() {
    return this.exec(`
      const btn = document.getElementById(${json(S.buttonId)});
      if (!btn) return { exists: false };

      // Mirror dom.clearControl() loosely: an element whose label/text is "clear".
      function findClear() {
        const sel = "toolbarbutton, button, label, span, hbox, vbox, toolbaritem, [label], [tooltiptext]";
        for (const el of document.querySelectorAll(sel)) {
          if (el === btn) continue;
          const label = (el.getAttribute && el.getAttribute("label") || "").trim().toLowerCase();
          if (label === "clear") return el;
          const text = (el.textContent || "").trim().toLowerCase();
          if (text === "clear") return el;
        }
        return null;
      }

      const clear = findClear();
      return {
        exists: true,
        isTwin: btn.dataset && btn.dataset.twin === "1",
        hasClear: !!clear,
        sameParentAsClear: clear ? btn.parentElement === clear.parentElement : null,
        immediatelyBeforeClear: clear ? btn.nextElementSibling === clear : null,
        inActiveSection: !!btn.closest(".zen-workspace-tabs-section"),
      };
    `);
  }

  /** Real right-click on the Tidy button, with a dispatched-event fallback. */
  async rightClickButton() {
    await this.waitForButton();
    const el = await this.byId(S.buttonId);
    try {
      await this.actions().contextClick(el).perform();
      return "native";
    } catch {
      await this.exec(
        `document.getElementById(${json(
          S.buttonId
        )}).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); return true;`
      );
      return "dispatched";
    }
  }

  /** Real click on the Tidy button, with a dispatched-click fallback. */
  async clickButton() {
    await this.waitForButton();
    const el = await this.byId(S.buttonId);
    try {
      await this.actions().move({ origin: el }).pause(50).perform();
      await el.click();
      return "native";
    } catch {
      await this.exec(
        `document.getElementById(${json(S.buttonId)}).click(); return true;`
      );
      return "dispatched";
    }
  }

  // ---- tabs & groups -----------------------------------------------------

  /**
   * Reset to a clean single-tab, no-group state and dismiss any open modal.
   * Safe to call before every test.
   */
  async reset() {
    await this.restoreFetch();
    await this.exec(`
      const overlay = document.getElementById(${json(S.overlayId)});
      if (overlay) overlay.remove();

      const principal = Services.scriptSecurityManager.getSystemPrincipal();
      const keep = (typeof gBrowser.addTrustedTab === "function")
        ? gBrowser.addTrustedTab("about:blank")
        : gBrowser.addTab("about:blank", { triggeringPrincipal: principal });
      gBrowser.selectedTab = keep;

      for (const t of [...gBrowser.tabs]) {
        if (t === keep || t.pinned) continue;
        try { gBrowser.removeTab(t, { animate: false }); } catch (e) {}
      }
      for (const g of [...document.querySelectorAll("tab-group")]) {
        try {
          if (typeof gBrowser.removeTabGroup === "function") gBrowser.removeTabGroup(g);
          else g.remove();
        } catch (e) { try { g.remove(); } catch (e2) {} }
      }
      return true;
    `);
  }

  /** Open `n` ungrouped data: tabs with distinct titles; wait until eligible. */
  async openTabs(n, prefix = "Page ") {
    await this.exec(
      `
      const n = arguments[0], prefix = arguments[1];
      const principal = Services.scriptSecurityManager.getSystemPrincipal();
      for (let i = 0; i < n; i++) {
        const url = "data:text/html,<title>" + encodeURIComponent(prefix + i) + "</title>";
        if (typeof gBrowser.addTrustedTab === "function") gBrowser.addTrustedTab(url);
        else gBrowser.addTab(url, { triggeringPrincipal: principal });
      }
      return true;
    `,
      n,
      prefix
    );
    await this.driver.wait(
      async () => (await this.collectCount()) >= n,
      15_000,
      `fewer than ${n} eligible tabs after opening`,
      300
    );
  }

  /** Number of tabs the script would tidy (zenTidyTabs.collect(true)). */
  collectCount() {
    return this.exec(
      `return window[${json(S.globalApi)}].collect(true).length;`
    );
  }

  /** Create a native Zen tab group with a known label + color. */
  async createGroup(label, color, n = 2) {
    const ok = await this.exec(
      `
      const label = arguments[0], color = arguments[1], n = arguments[2];
      const principal = Services.scriptSecurityManager.getSystemPrincipal();
      const ts = [];
      for (let i = 0; i < n; i++) {
        const url = "data:text/html,<title>" + encodeURIComponent(label + " " + i) + "</title>";
        ts.push((typeof gBrowser.addTrustedTab === "function")
          ? gBrowser.addTrustedTab(url)
          : gBrowser.addTab(url, { triggeringPrincipal: principal }));
      }
      let g = null;
      try { g = gBrowser.addTabGroup(ts, { label, color, insertBefore: ts[0] }); }
      catch (e) { try { g = gBrowser.addTabGroup(ts, { label, color }); } catch (e2) {} }
      if (g) {
        try {
          g.label = label; g.setAttribute("label", label);
          g.color = color; g.setAttribute("color", color);
        } catch (e) {}
      }
      return !!g;
    `,
      label,
      color,
      n
    );
    if (!ok) throw new Error(`Could not create tab group "${label}"`);
    await this.driver.wait(
      async () => await this.groupLabelExists(label),
      10_000,
      `tab group "${label}" did not render`,
      200
    );
  }

  /** @returns {Promise<string[]>} labels of all live tab groups. */
  groupLabels() {
    return this.exec(
      `return [...document.querySelectorAll("tab-group")]
         .map(g => (g.label || (g.getAttribute && g.getAttribute("label")) || "").trim());`
    );
  }

  /** Whether a tab-group with a rendered `.tab-group-label` for `label` exists. */
  groupLabelExists(label) {
    return this.exec(
      `
      const want = arguments[0];
      for (const lab of document.querySelectorAll(${json(S.groupLabel)})) {
        const g = lab.closest("tab-group");
        if (!g) continue;
        if (((g.label || (g.getAttribute && g.getAttribute("label")) || "").trim()) === want) return true;
      }
      return false;
    `,
      label
    );
  }

  /** Color (named) of the group whose label === `label`, or null. */
  groupColor(label) {
    return this.exec(
      `
      const want = arguments[0];
      for (const g of document.querySelectorAll("tab-group")) {
        const l = (g.label || (g.getAttribute && g.getAttribute("label")) || "").trim();
        if (l === want) return g.color || (g.getAttribute && g.getAttribute("color")) || "";
      }
      return null;
    `,
      label
    );
  }

  /** Number of live tabs inside the group whose label === `label`. */
  groupTabCount(label) {
    return this.exec(
      `
      const want = arguments[0];
      for (const g of document.querySelectorAll("tab-group")) {
        const l = (g.label || (g.getAttribute && g.getAttribute("label")) || "").trim();
        if (l === want) {
          const list = g.tabs || g.querySelectorAll("tab, .tabbrowser-tab");
          return list.length;
        }
      }
      return 0;
    `,
      label
    );
  }

  // ---- group label (badge) editing --------------------------------------

  /** The `.tab-group-label` element for the group named `label`. */
  labelElement(label) {
    return this.$(`tab-group[label="${label}"] ${S.groupLabel}`);
  }

  /** Single click on a group badge (with a dispatched-click fallback). */
  async clickLabelOnce(label) {
    const el = await this.labelElement(label);
    try {
      await el.click();
      return "native";
    } catch {
      await this._dispatchLabelClicks(label, 1);
      return "dispatched";
    }
  }

  /** Double click on a group badge (with a dispatched fallback). */
  async doubleClickLabel(label) {
    const el = await this.labelElement(label);
    try {
      await this.actions().doubleClick(el).perform();
      return "native";
    } catch {
      await this._dispatchLabelClicks(label, 2);
      return "dispatched";
    }
  }

  async _dispatchLabelClicks(label, times) {
    await this.exec(
      `
      const want = arguments[0], n = arguments[1];
      let target = null;
      for (const lab of document.querySelectorAll(${json(S.groupLabel)})) {
        const g = lab.closest("tab-group");
        if (g && ((g.label || (g.getAttribute && g.getAttribute("label")) || "").trim()) === want) { target = lab; break; }
      }
      if (!target) return false;
      for (let i = 0; i < n; i++) target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return true;
    `,
      label,
      times
    );
  }

  /** Whether the badge for `label` is currently in inline-edit mode. */
  labelIsEditing(label) {
    return this.exec(
      `
      const want = arguments[0];
      for (const lab of document.querySelectorAll(${json(S.groupLabel)})) {
        const g = lab.closest("tab-group");
        if (!g) continue;
        if (((g.label || (g.getAttribute && g.getAttribute("label")) || "").trim()) === want) {
          return lab.classList.contains(${json(S.inlineEditingClass)}) &&
                 lab.getAttribute("contenteditable") === "true";
        }
      }
      return false;
    `,
      label
    );
  }

  /** Type into the focused inline editor: select-all, replace, commit (Enter). */
  async commitInlineRename(label, newName) {
    const el = await this.labelElement(label);
    await el.sendKeys(Key.chord(Key.CONTROL, "a"), newName, Key.ENTER);
  }

  // ---- modal -------------------------------------------------------------

  async waitForOverlay() {
    await this.driver.wait(
      async () =>
        (await this.exec(
          `return !!document.getElementById(${json(S.overlayId)});`
        )) === true,
      10_000,
      "modal overlay did not appear",
      150
    );
  }

  async waitForNoOverlay() {
    await this.driver.wait(
      async () =>
        (await this.exec(
          `return !document.getElementById(${json(S.overlayId)});`
        )) === true,
      10_000,
      "modal overlay did not close",
      150
    );
  }

  overlayTitle() {
    return this.exec(
      `const t = document.querySelector(${json(S.modalTitle)}); return t ? t.textContent.trim() : null;`
    );
  }

  hasModalPasswordField() {
    return this.exec(
      `return !!document.querySelector(${json(S.modalBody)} + " " + ${json(
        S.input
      )} + "[type=password]") ||
              !!document.querySelector(${json(S.input)} + "[type=password]");`
    );
  }

  /** Fill the (first) modal text input. */
  async fillModalName(text) {
    const input = await this.$(`${S.modalBody} ${S.input}`);
    await input.clear();
    await input.sendKeys(text);
  }

  /** Click the color swatch named `colorName` (its title attribute). */
  async pickSwatch(colorName) {
    const sw = await this.$(`${S.swatch}[title="${colorName}"]`);
    await sw.click();
  }

  /** Click the primary footer button (Save). */
  async clickPrimary() {
    const btn = await this.$(`${S.modalFooter} ${S.btnPrimary}`);
    await btn.click();
  }

  async pressEscape() {
    await this.driver.switchTo().activeElement().sendKeys(Key.ESCAPE);
  }

  // ---- network stub ------------------------------------------------------

  /**
   * Replace the chrome window's fetch with one that returns a canned
   * OpenRouter chat-completion whose content is `grouping` (a {groups:[...]} obj).
   */
  async installFetchStub(grouping) {
    const content = JSON.stringify(grouping);
    const payload = JSON.stringify({
      id: "zen-tidy-tabs-stub",
      model: "zen-tidy-tabs-stub",
      choices: [
        { index: 0, message: { role: "assistant", content }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
    await this.exec(`
      if (!window.__zenTidyTabsOrigFetch) window.__zenTidyTabsOrigFetch = window.fetch;
      const __payload = ${json(payload)};
      window.fetch = function () {
        return Promise.resolve(new window.Response(__payload, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      };
      return true;
    `);
  }

  async restoreFetch() {
    await this.exec(`
      if (window.__zenTidyTabsOrigFetch) {
        window.fetch = window.__zenTidyTabsOrigFetch;
        window.__zenTidyTabsOrigFetch = undefined;
      }
      return true;
    `);
  }
}

/** Safely embed a JS value as a literal inside an exec() script string. */
function json(value) {
  return JSON.stringify(value);
}

/**
 * Resolve an absolute path to a geckodriver binary, downloading it (once) into
 * a stable project-local cache so we don't refetch on every run. Honors an
 * explicit GECKODRIVER_PATH override.
 * @returns {Promise<string>}
 */
async function resolveGeckodriver() {
  if (process.env.GECKODRIVER_PATH && fs.existsSync(process.env.GECKODRIVER_PATH)) {
    return process.env.GECKODRIVER_PATH;
  }
  const geckodriver = require("geckodriver");
  const cacheDir = path.resolve(__dirname, "..", ".geckodriver");
  fs.mkdirSync(cacheDir, { recursive: true });
  // download() returns the absolute path to the (cached or freshly fetched) exe.
  return geckodriver.download(undefined, cacheDir);
}

module.exports = { ZenDriver, SCRIPT_PATH, ZEN_BINARY, STUB_API_KEY };
