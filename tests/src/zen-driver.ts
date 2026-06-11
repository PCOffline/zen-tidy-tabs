import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Builder, By, type WebElement } from "selenium-webdriver";
import * as firefox from "selenium-webdriver/firefox.js";
import { selectors as S } from "./selectors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the userChrome script under test. */
const SCRIPT_PATH = path.resolve(__dirname, "..", "..", "index.uc.js");

/** Path to the Zen executable. Override with the ZEN_BINARY env var. */
const ZEN_BINARY =
  process.env.ZEN_BINARY ?? "C:\\Program Files\\Zen Browser\\zen.exe";

/** Dummy key so orchestrator.runTidy() doesn't bail before reaching fetch(). */
const STUB_API_KEY = "sk-or-v1-zen-tidy-tabs-test-key";

/** Where the Tidy control ended up relative to Zen's Clear control. */
export interface ButtonPlacement {
  exists: boolean;
  isTwin?: boolean;
  hasClear?: boolean;
  sameParentAsClear?: boolean | null;
  immediatelyBeforeClear?: boolean | null;
  inActiveSection?: boolean;
}

/** A canned OpenRouter grouping plan: `{ groups: [{ name, tabs: [idx...] }] }`. */
export interface GroupingPlan {
  groups: Array<{ name: string; tabs: number[] }>;
}

/** How an interaction was performed: a real WebDriver action or a dispatched DOM event. */
export type InteractionKind = "native" | "dispatched";

/**
 * Drives a real Zen browser in Marionette **chrome context** (the browser
 * chrome / sidebar, where this userscript lives), exposing high-level helpers
 * the specs use. Everything runs against the actual injected script.
 */
export class ZenDriver {
  readonly driver: firefox.Driver;

  constructor(driver: firefox.Driver) {
    this.driver = driver;
  }

  static get binaryPath(): string {
    return ZEN_BINARY;
  }

  /** Launch Zen, switch to chrome context, inject the script, wait for mount. */
  static async launch(): Promise<ZenDriver> {
    if (!fs.existsSync(ZEN_BINARY)) {
      throw new Error(
        `Zen executable not found at "${ZEN_BINARY}". ` +
          "Set the ZEN_BINARY env var to your zen.exe path.",
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

    const driver = (await new Builder()
      .forBrowser("firefox")
      .setFirefoxOptions(options)
      .setFirefoxService(service)
      .build()) as firefox.Driver;

    const zen = new ZenDriver(driver);
    await driver.setContext(firefox.Context.CHROME);
    await zen.waitForBrowser();
    await zen.injectScript();
    await zen.waitForButton();
    return zen;
  }

  async quit(): Promise<void> {
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
   */
  exec<T>(script: string, ...args: unknown[]): Promise<T> {
    return this.driver.executeScript<T>(script, ...args);
  }

  byId(id: string): Promise<WebElement> {
    return this.driver.findElement(By.id(id));
  }

  $(css: string): Promise<WebElement> {
    return this.driver.findElement(By.css(css));
  }

  actions() {
    return this.driver.actions({ async: true });
  }

  private async waitForBrowser(): Promise<void> {
    await this.driver.wait(
      async () =>
        (await this.exec<boolean>(
          "return !!(window.gBrowser && gBrowser.tabs && typeof gBrowser.tabs.length === 'number');",
        )) === true,
      30_000,
      "gBrowser was not ready in the chrome window",
      300,
    );
  }

  /** Inject the full userChrome script (its IIFE auto-runs init()). */
  async injectScript(): Promise<void> {
    const scriptText = fs.readFileSync(SCRIPT_PATH, "utf8");
    await this.exec(scriptText);
  }

  // ---- mounting / button -------------------------------------------------

  /** Wait until the Tidy control is in the DOM, nudging mount()/hover. */
  async waitForButton(): Promise<void> {
    await this.driver.wait(
      async () => {
        const present = await this.exec<boolean>(
          `return !!document.getElementById(${json(S.buttonId)});`,
        );
        if (present) return true;
        // Nudge: re-run mount() and fire a chrome-wide mouseover so the Clear
        // watcher gets a chance to place the twin.
        await this.exec(
          `try { window[${json(S.globalApi)}] && window[${json(
            S.globalApi,
          )}].mount(); } catch (e) {}
           document.documentElement.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
           return true;`,
        );
        return false;
      },
      15_000,
      "Tidy control never mounted",
      400,
    );
  }

  buttonExists(): Promise<boolean> {
    return this.exec<boolean>(
      `return !!document.getElementById(${json(S.buttonId)});`,
    );
  }

  /** Inspect where the Tidy control sits relative to Zen's Clear control. */
  getButtonPlacement(): Promise<ButtonPlacement> {
    return this.exec<ButtonPlacement>(`
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
  async rightClickButton(): Promise<InteractionKind> {
    await this.waitForButton();
    const el = await this.byId(S.buttonId);
    try {
      await this.actions().contextClick(el).perform();
      return "native";
    } catch {
      await this.exec(
        `document.getElementById(${json(
          S.buttonId,
        )}).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); return true;`,
      );
      return "dispatched";
    }
  }

  /** Real click on the Tidy button, with a dispatched-click fallback. */
  async clickButton(): Promise<InteractionKind> {
    await this.waitForButton();
    const el = await this.byId(S.buttonId);
    try {
      await this.actions().move({ origin: el }).pause(50).perform();
      await el.click();
      return "native";
    } catch {
      await this.exec(
        `document.getElementById(${json(S.buttonId)}).click(); return true;`,
      );
      return "dispatched";
    }
  }

  // ---- tabs & groups -----------------------------------------------------

  /**
   * Reset to a clean single-tab, no-group state and dismiss any open modal.
   * Safe to call before every test.
   */
  async reset(): Promise<void> {
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
  async openTabs(n: number, prefix = "Page "): Promise<void> {
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
      prefix,
    );
    await this.driver.wait(
      async () => (await this.collectCount()) >= n,
      15_000,
      `fewer than ${n} eligible tabs after opening`,
      300,
    );
  }

  /** Number of tabs the script would tidy (zenTidyTabs.collect(true)). */
  collectCount(): Promise<number> {
    return this.exec<number>(
      `return window[${json(S.globalApi)}].collect(true).length;`,
    );
  }

  /** Create a native Zen tab group with a known label + color. */
  async createGroup(label: string, color: string, n = 2): Promise<void> {
    const ok = await this.exec<boolean>(
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
      n,
    );
    if (!ok) throw new Error(`Could not create tab group "${label}"`);
    await this.driver.wait(
      async () => await this.groupLabelExists(label),
      10_000,
      `tab group "${label}" did not render`,
      200,
    );
  }

  /** Labels of all live tab groups. */
  groupLabels(): Promise<string[]> {
    return this.exec<string[]>(
      `return [...document.querySelectorAll("tab-group")]
         .map(g => (g.label || (g.getAttribute && g.getAttribute("label")) || "").trim());`,
    );
  }

  /** Whether a tab-group with a rendered `.tab-group-label` for `label` exists. */
  groupLabelExists(label: string): Promise<boolean> {
    return this.exec<boolean>(
      `
      const want = arguments[0];
      for (const lab of document.querySelectorAll(${json(S.groupLabel)})) {
        const g = lab.closest("tab-group");
        if (!g) continue;
        if (((g.label || (g.getAttribute && g.getAttribute("label")) || "").trim()) === want) return true;
      }
      return false;
    `,
      label,
    );
  }

  /** Color (named) of the group whose label === `label`, or null. */
  groupColor(label: string): Promise<string | null> {
    return this.exec<string | null>(
      `
      const want = arguments[0];
      for (const g of document.querySelectorAll("tab-group")) {
        const l = (g.label || (g.getAttribute && g.getAttribute("label")) || "").trim();
        if (l === want) return g.color || (g.getAttribute && g.getAttribute("color")) || "";
      }
      return null;
    `,
      label,
    );
  }

  /** Number of live tabs inside the group whose label === `label`. */
  groupTabCount(label: string): Promise<number> {
    return this.exec<number>(
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
      label,
    );
  }

  // ---- group label (badge) editing --------------------------------------

  /** The `.tab-group-label` element for the group named `label`. */
  labelElement(label: string): Promise<WebElement> {
    return this.$(`tab-group[label="${label}"] ${S.groupLabel}`);
  }

  /** Single click on a group badge (with a dispatched-click fallback). */
  async clickLabelOnce(label: string): Promise<InteractionKind> {
    const el = await this.labelElement(label);
    try {
      await el.click();
      return "native";
    } catch {
      await this.dispatchLabelClicks(label, 1);
      return "dispatched";
    }
  }

  /** Double click on a group badge (with a dispatched fallback). */
  async doubleClickLabel(label: string): Promise<InteractionKind> {
    const el = await this.labelElement(label);
    try {
      await this.actions().doubleClick(el).perform();
      return "native";
    } catch {
      await this.dispatchLabelClicks(label, 2);
      return "dispatched";
    }
  }

  private async dispatchLabelClicks(
    label: string,
    times: number,
  ): Promise<void> {
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
      times,
    );
  }

  /** Whether the badge for `label` is currently in inline-edit mode. */
  labelIsEditing(label: string): Promise<boolean> {
    return this.exec<boolean>(
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
      label,
    );
  }

  /**
   * Replace the inline editor's text with `newName` and commit it.
   *
   * Selenium's native keyboard can't reach chrome XUL/contenteditable elements,
   * so we drive the editor the way the script itself expects: set the label's
   * text, then dispatch an Enter keydown. The editor's keydown handler calls
   * `labelEl.blur()`, whose `blur` listener performs the actual rename.
   */
  async commitInlineRename(label: string, newName: string): Promise<void> {
    await this.exec(
      `
      const want = arguments[0], name = arguments[1];
      let target = null;
      for (const lab of document.querySelectorAll(${json(S.groupLabel)})) {
        const g = lab.closest("tab-group");
        if (g && ((g.label || (g.getAttribute && g.getAttribute("label")) || "").trim()) === want) { target = lab; break; }
      }
      if (!target) return false;
      target.focus();
      target.textContent = name;
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      // Belt and braces: if the element never held focus, blur() above is a
      // no-op, so fire the commit listener directly.
      target.dispatchEvent(new FocusEvent("blur"));
      return true;
    `,
      label,
      newName,
    );
  }

  // ---- modal -------------------------------------------------------------

  async waitForOverlay(): Promise<void> {
    await this.driver.wait(
      async () =>
        (await this.exec<boolean>(
          `return !!document.getElementById(${json(S.overlayId)});`,
        )) === true,
      10_000,
      "modal overlay did not appear",
      150,
    );
  }

  async waitForNoOverlay(): Promise<void> {
    await this.driver.wait(
      async () =>
        (await this.exec<boolean>(
          `return !document.getElementById(${json(S.overlayId)});`,
        )) === true,
      10_000,
      "modal overlay did not close",
      150,
    );
  }

  overlayTitle(): Promise<string | null> {
    return this.exec<string | null>(
      `const t = document.querySelector(${json(S.modalTitle)}); return t ? t.textContent.trim() : null;`,
    );
  }

  hasModalPasswordField(): Promise<boolean> {
    return this.exec<boolean>(
      `return !!document.querySelector(${json(S.modalBody)} + " " + ${json(
        S.input,
      )} + "[type=password]") ||
              !!document.querySelector(${json(S.input)} + "[type=password]");`,
    );
  }

  /** Fill the (first) modal text input. */
  async fillModalName(text: string): Promise<void> {
    const input = await this.$(`${S.modalBody} ${S.input}`);
    await input.clear();
    await input.sendKeys(text);
  }

  /** Click the color swatch named `colorName` (its title attribute). */
  async pickSwatch(colorName: string): Promise<void> {
    const sw = await this.$(`${S.swatch}[title="${colorName}"]`);
    await sw.click();
  }

  /** Click the primary footer button (Save). */
  async clickPrimary(): Promise<void> {
    const btn = await this.$(`${S.modalFooter} ${S.btnPrimary}`);
    await btn.click();
  }

  async pressEscape(): Promise<void> {
    // chrome context has no switchTo().activeElement(); the modal listens for a
    // capturing keydown on `document`, so dispatch Escape there directly.
    await this.exec(
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));`,
    );
  }

  // ---- network stub ------------------------------------------------------

  /**
   * Replace the chrome window's fetch with one that returns a canned
   * OpenRouter chat-completion whose content is `grouping` (a {groups:[...]} obj).
   */
  async installFetchStub(grouping: GroupingPlan): Promise<void> {
    const content = JSON.stringify(grouping);
    const payload = JSON.stringify({
      id: "zen-tidy-tabs-stub",
      model: "zen-tidy-tabs-stub",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
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

  async restoreFetch(): Promise<void> {
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
function json(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Resolve an absolute path to a geckodriver binary, downloading it (once) into
 * a stable project-local cache so we don't refetch on every run. Honors an
 * explicit GECKODRIVER_PATH override.
 */
async function resolveGeckodriver(): Promise<string> {
  const override = process.env.GECKODRIVER_PATH;
  if (override && fs.existsSync(override)) return override;

  const { download } = await import("geckodriver");
  const cacheDir = path.resolve(__dirname, "..", ".geckodriver");
  fs.mkdirSync(cacheDir, { recursive: true });
  // download() returns the absolute path to the (cached or freshly fetched) exe.
  return download(undefined, cacheDir);
}

export { SCRIPT_PATH, STUB_API_KEY, ZEN_BINARY };
