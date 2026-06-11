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
 * A function injected into the chrome window via {@link ZenDriver.exec}. It is
 * serialized and evaluated in the browser process, so it must be self-contained
 * (reference only its parameters and browser/chrome globals). `args` are
 * marshalled by WebDriver and arrive as the function's parameters.
 */
type InjectedFn<A extends unknown[], R> = (...args: A) => R;

/**
 * Drives a real Zen browser in Marionette **chrome context** (the browser
 * chrome / sidebar, where this userscript lives), exposing high-level helpers
 * the specs use. Everything runs against the actual injected script.
 */
export class ZenDriver {
  readonly driver: firefox.Driver;

  /**
   * True when launched headless (ZEN_HEADLESS=1). Headless Firefox/Zen exposes
   * the chrome DOM but reports its elements as not-displayed, so native
   * WebDriver input is unreliable: `el.click()`/`sendKeys` throw, while the
   * pointer Actions API (`contextClick`, `doubleClick`) silently misses without
   * throwing. So in headless the interaction helpers skip native input and
   * dispatch DOM events directly, which the userscript's listeners handle the
   * same way.
   */
  private readonly headless = process.env.ZEN_HEADLESS === "1";

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
    // Skip Zen's first-run onboarding ("Welcome to a calmer internet") and the
    // brief splash screen, both of which otherwise show on every fresh profile.
    options.setPreference("zen.welcome-screen.seen", true);
    options.setPreference("zen.watermark.enabled", false);
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
   * Run code in the chrome window.
   *
   * Prefer passing a real function: Selenium serializes it (`fn.toString()`),
   * ships the source across the WebDriver wire, and runs it in the browser as
   * `(fn).apply(null, args)`. Because it crosses a process boundary the body
   * MUST be self-contained -- it can reference only its own parameters plus
   * browser/chrome globals, never anything captured from this module's scope.
   * Pass any needed values (selectors, counts, ...) as `args`.
   *
   * The string overload exists only for raw script text (e.g. the userscript
   * itself) that isn't expressible as a function.
   */
  exec<R, A extends unknown[]>(fn: InjectedFn<A, R>, ...args: A): Promise<R>;
  exec<R = unknown>(script: string): Promise<R>;
  exec<R>(
    script: string | InjectedFn<unknown[], R>,
    ...args: unknown[]
  ): Promise<R> {
    return this.driver.executeScript<R>(script, ...args);
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

  /**
   * Attempt a native WebDriver interaction, reporting whether it was used.
   * Skipped outright in headless (see {@link headless}); otherwise runs the
   * action and treats a thrown error (e.g. element not interactable) as "not
   * used" so the caller can fall back to dispatched DOM events.
   */
  private async tryNative(action: () => Promise<unknown>): Promise<boolean> {
    if (this.headless) {
      return false;
    }
    try {
      await action();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Poll briefly for the modal overlay, resolving true if it appears.
   *
   * Used to confirm that an interaction actually took effect. Marionette's
   * pointer Actions API (`contextClick`, `doubleClick`) silently no-ops against
   * chrome XUL elements -- in headless AND headed mode -- yet `perform()` still
   * resolves, so a successful-looking native call can't be trusted on its own.
   * The timeout must clear the editor's 300ms single-vs-double click debounce.
   */
  private async overlayAppeared(timeoutMs = 1500): Promise<boolean> {
    try {
      await this.driver.wait(
        async () =>
          (await this.exec(
            (overlayId: string) => !!document.getElementById(overlayId),
            S.overlayId,
          )) === true,
        timeoutMs,
        "overlay did not appear",
        100,
      );
      return true;
    } catch {
      return false;
    }
  }

  private async waitForBrowser(): Promise<void> {
    await this.driver.wait(
      async () =>
        (await this.exec(
          () =>
            typeof gBrowser !== "undefined" &&
            !!gBrowser.tabs &&
            typeof gBrowser.tabs.length === "number",
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
        const present = await this.exec(
          (id: string) => !!document.getElementById(id),
          S.buttonId,
        );
        if (present) {
          return true;
        }
        // Nudge: re-run mount() and fire a chrome-wide mouseover so the Clear
        // watcher gets a chance to place the twin.
        await this.exec(() => {
          try {
            window.zenTidyTabs?.mount();
          } catch {
            // best effort: the watcher retry below still gets a chance
          }
          document.documentElement.dispatchEvent(
            new MouseEvent("mouseover", { bubbles: true }),
          );
          return true;
        });
        return false;
      },
      15_000,
      "Tidy control never mounted",
      400,
    );
  }

  buttonExists(): Promise<boolean> {
    return this.exec((id: string) => !!document.getElementById(id), S.buttonId);
  }

  /** Inspect where the Tidy control sits relative to Zen's Clear control. */
  getButtonPlacement(): Promise<ButtonPlacement> {
    return this.exec((buttonId: string): ButtonPlacement => {
      const btn = document.getElementById(buttonId);
      if (!btn) {
        return { exists: false };
      }

      // Mirror dom.clearControl() loosely: an element whose label/text is "clear".
      const findClear = (): Element | null => {
        const sel =
          "toolbarbutton, button, label, span, hbox, vbox, toolbaritem, [label], [tooltiptext]";
        for (const el of document.querySelectorAll(sel)) {
          if (el === btn) {
            continue;
          }
          const label = (el.getAttribute("label") || "").trim().toLowerCase();
          if (label === "clear") {
            return el;
          }
          const text = (el.textContent || "").trim().toLowerCase();
          if (text === "clear") {
            return el;
          }
        }
        return null;
      };

      const clear = findClear();
      return {
        exists: true,
        isTwin: btn.dataset.twin === "1",
        hasClear: !!clear,
        sameParentAsClear: clear
          ? btn.parentElement === clear.parentElement
          : null,
        immediatelyBeforeClear: clear ? btn.nextElementSibling === clear : null,
        inActiveSection: !!btn.closest(".zen-workspace-tabs-section"),
      };
    }, S.buttonId);
  }

  /** Real right-click on the Tidy button, with a dispatched-event fallback. */
  async rightClickButton(): Promise<InteractionKind> {
    await this.waitForButton();
    const el = await this.byId(S.buttonId);
    // Native context-click works headed against content, but Marionette's
    // Actions API silently no-ops against chrome XUL (headed and headless),
    // so trust it only if the settings overlay actually opened.
    if (
      (await this.tryNative(() => this.actions().contextClick(el).perform())) &&
      (await this.overlayAppeared())
    ) {
      return "native";
    }
    await this.exec((id: string) => {
      document
        .getElementById(id)
        ?.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        );
      return true;
    }, S.buttonId);
    return "dispatched";
  }

  /** Real click on the Tidy button, with a dispatched-click fallback. */
  async clickButton(): Promise<InteractionKind> {
    await this.waitForButton();
    const el = await this.byId(S.buttonId);
    if (
      await this.tryNative(async () => {
        await this.actions().move({ origin: el }).pause(50).perform();
        await el.click();
      })
    ) {
      return "native";
    }
    await this.exec((id: string) => {
      document.getElementById(id)?.click();
      return true;
    }, S.buttonId);
    return "dispatched";
  }

  // ---- tabs & groups -----------------------------------------------------

  /**
   * Reset to a clean single-tab, no-group state and dismiss any open modal.
   * Safe to call before every test.
   */
  async reset(): Promise<void> {
    await this.restoreFetch();
    await this.exec((overlayId: string) => {
      const overlay = document.getElementById(overlayId);
      if (overlay) {
        overlay.remove();
      }

      const principal = Services.scriptSecurityManager.getSystemPrincipal();
      const keep =
        typeof gBrowser.addTrustedTab === "function"
          ? gBrowser.addTrustedTab("about:blank")
          : gBrowser.addTab("about:blank", { triggeringPrincipal: principal });
      gBrowser.selectedTab = keep;

      for (const t of [...gBrowser.tabs]) {
        if (t === keep || t.pinned) {
          continue;
        }
        try {
          gBrowser.removeTab(t, { animate: false });
        } catch {
          // ignore tabs that refuse to close; reset is best effort
        }
      }
      for (const g of document.querySelectorAll<MozTabGroup>("tab-group")) {
        try {
          if (typeof gBrowser.removeTabGroup === "function") {
            gBrowser.removeTabGroup(g);
          } else {
            g.remove();
          }
        } catch {
          try {
            g.remove();
          } catch {
            // group already detached; nothing left to do
          }
        }
      }
      return true;
    }, S.overlayId);
  }

  /** Open `n` ungrouped data: tabs with distinct titles; wait until eligible. */
  async openTabs(n: number, prefix = "Page "): Promise<void> {
    await this.exec(
      (count: number, titlePrefix: string) => {
        const principal = Services.scriptSecurityManager.getSystemPrincipal();
        for (let i = 0; i < count; i++) {
          const url = `data:text/html,<title>${encodeURIComponent(`${titlePrefix}${i}`)}</title>`;
          if (typeof gBrowser.addTrustedTab === "function") {
            gBrowser.addTrustedTab(url);
          } else {
            gBrowser.addTab(url, { triggeringPrincipal: principal });
          }
        }
        return true;
      },
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
    return this.exec(() => window.zenTidyTabs.collect(true).length);
  }

  /** Create a native Zen tab group with a known label + color. */
  async createGroup(label: string, color: string, n = 2): Promise<void> {
    const ok = await this.exec(
      (groupLabel: string, groupColor: string, count: number) => {
        const principal = Services.scriptSecurityManager.getSystemPrincipal();
        const ts: MozTab[] = [];
        for (let i = 0; i < count; i++) {
          const url = `data:text/html,<title>${encodeURIComponent(`${groupLabel} ${i}`)}</title>`;
          ts.push(
            typeof gBrowser.addTrustedTab === "function"
              ? gBrowser.addTrustedTab(url)
              : gBrowser.addTab(url, { triggeringPrincipal: principal }),
          );
        }
        let g: MozTabGroup | null = null;
        try {
          g = gBrowser.addTabGroup(ts, {
            label: groupLabel,
            color: groupColor,
            insertBefore: ts[0],
          });
        } catch {
          try {
            g = gBrowser.addTabGroup(ts, {
              label: groupLabel,
              color: groupColor,
            });
          } catch {
            // both addTabGroup signatures failed; leave g null
          }
        }
        if (g) {
          try {
            g.label = groupLabel;
            g.setAttribute("label", groupLabel);
            g.color = groupColor;
            g.setAttribute("color", groupColor);
          } catch {
            // label/color already applied by addTabGroup; ignore
          }
        }
        return !!g;
      },
      label,
      color,
      n,
    );
    if (!ok) {
      throw new Error(`Could not create tab group "${label}"`);
    }
    await this.driver.wait(
      async () => await this.groupLabelExists(label),
      10_000,
      `tab group "${label}" did not render`,
      200,
    );
  }

  /** Labels of all live tab groups. */
  groupLabels(): Promise<string[]> {
    return this.exec(() =>
      [...document.querySelectorAll<MozTabGroup>("tab-group")].map((g) =>
        (g.label || g.getAttribute("label") || "").trim(),
      ),
    );
  }

  /** Whether a tab-group with a rendered `.tab-group-label` for `label` exists. */
  groupLabelExists(label: string): Promise<boolean> {
    return this.exec(
      (labelSel: string, want: string) => {
        for (const lab of document.querySelectorAll(labelSel)) {
          const g = lab.closest<MozTabGroup>("tab-group");
          if (!g) {
            continue;
          }
          if ((g.label || g.getAttribute("label") || "").trim() === want) {
            return true;
          }
        }
        return false;
      },
      S.groupLabel,
      label,
    );
  }

  /** Color (named) of the group whose label === `label`, or null. */
  groupColor(label: string): Promise<string | null> {
    return this.exec((want: string) => {
      for (const g of document.querySelectorAll<MozTabGroup>("tab-group")) {
        const l = (g.label || g.getAttribute("label") || "").trim();
        if (l === want) {
          return g.color || g.getAttribute("color") || "";
        }
      }
      return null;
    }, label);
  }

  /** Number of live tabs inside the group whose label === `label`. */
  groupTabCount(label: string): Promise<number> {
    return this.exec((want: string) => {
      for (const g of document.querySelectorAll<MozTabGroup>("tab-group")) {
        const l = (g.label || g.getAttribute("label") || "").trim();
        if (l === want) {
          const list = g.tabs || g.querySelectorAll("tab, .tabbrowser-tab");
          return list.length;
        }
      }
      return 0;
    }, label);
  }

  // ---- re-tidy flicker watcher -------------------------------------------

  /**
   * Start watching the tab strip for the re-tidy flicker: any moment where the
   * old groups are still painted alongside the freshly built ones. A
   * MutationObserver records, across the whole operation, the most labelled
   * `<tab-group>` elements seen at once and the worst single-label duplication.
   *
   * The observer fires synchronously-after each DOM mutation batch (a microtask,
   * before any deferred-cleanup timer), so it reliably catches the transient
   * intermediate DOM that `groups.apply()` produces -- whether that's an empty
   * husk an abandoned group left behind (reconcile path) or a same-named ghost
   * from the flatten+rebuild (recreate path).
   */
  async startReTidyWatch(): Promise<void> {
    await this.exec(() => {
      const root =
        document.getElementById("tabbrowser-tabs") || document.documentElement;
      const labelOf = (g: MozTabGroup) =>
        (g.label || g.getAttribute("label") || "").trim();
      const scan = () => {
        const counts = new Map<string, number>();
        let labelled = 0;
        for (const g of document.querySelectorAll<MozTabGroup>("tab-group")) {
          const l = labelOf(g);
          if (!l) {
            continue;
          }
          labelled++;
          counts.set(l, (counts.get(l) || 0) + 1);
        }
        let dup = 1;
        for (const v of counts.values()) {
          if (v > dup) {
            dup = v;
          }
        }
        const w = window.__zenTidyReTidyWatch;
        if (!w) {
          return;
        }
        if (labelled > w.maxLabelled) {
          w.maxLabelled = labelled;
          w.labelsAtPeak = [...counts.keys()];
        }
        if (dup > w.maxDuplicate) {
          w.maxDuplicate = dup;
        }
      };
      const obs = new MutationObserver(scan);
      window.__zenTidyReTidyWatch = {
        maxLabelled: 0,
        maxDuplicate: 1,
        labelsAtPeak: [],
        obs,
        scan,
      };
      obs.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["label"],
      });
      scan();
      return true;
    });
  }

  /** Disconnect the watcher and return what it observed. */
  stopReTidyWatch(): Promise<{
    maxLabelled: number;
    maxDuplicate: number;
    labelsAtPeak: string[];
  }> {
    return this.exec(() => {
      const w = window.__zenTidyReTidyWatch;
      if (!w) {
        return {
          maxLabelled: 0,
          maxDuplicate: 1,
          labelsAtPeak: [] as string[],
        };
      }
      try {
        w.obs?.disconnect();
      } catch {
        // observer may already be disconnected
      }
      window.__zenTidyReTidyWatch = undefined;
      return {
        maxLabelled: w.maxLabelled,
        maxDuplicate: w.maxDuplicate,
        labelsAtPeak: w.labelsAtPeak,
      };
    });
  }

  // ---- group label (badge) editing --------------------------------------

  /** The `.tab-group-label` element for the group named `label`. */
  labelElement(label: string): Promise<WebElement> {
    return this.$(`tab-group[label="${label}"] ${S.groupLabel}`);
  }

  /** Single click on a group badge (with a dispatched-click fallback). */
  async clickLabelOnce(label: string): Promise<InteractionKind> {
    const el = await this.labelElement(label);
    if (await this.tryNative(() => el.click())) {
      return "native";
    }
    await this.dispatchLabelClicks(label, 1);
    return "dispatched";
  }

  /** Double click on a group badge (with a dispatched fallback). */
  async doubleClickLabel(label: string): Promise<InteractionKind> {
    const el = await this.labelElement(label);
    // doubleClick goes through the same unreliable Actions API as the
    // right-click above; confirm the edit modal opened before trusting it.
    if (
      (await this.tryNative(() => this.actions().doubleClick(el).perform())) &&
      (await this.overlayAppeared())
    ) {
      return "native";
    }
    await this.dispatchLabelClicks(label, 2);
    return "dispatched";
  }

  private async dispatchLabelClicks(
    label: string,
    times: number,
  ): Promise<void> {
    await this.exec(
      (labelSel: string, want: string, n: number) => {
        let target: HTMLElement | null = null;
        for (const lab of document.querySelectorAll<HTMLElement>(labelSel)) {
          const g = lab.closest<MozTabGroup>("tab-group");
          if (g && (g.label || g.getAttribute("label") || "").trim() === want) {
            target = lab;
            break;
          }
        }
        if (!target) {
          return false;
        }
        for (let i = 0; i < n; i++) {
          target.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true }),
          );
        }
        return true;
      },
      S.groupLabel,
      label,
      times,
    );
  }

  /** Whether the badge for `label` is currently in inline-edit mode. */
  labelIsEditing(label: string): Promise<boolean> {
    return this.exec(
      (labelSel: string, want: string, editingClass: string) => {
        for (const lab of document.querySelectorAll<HTMLElement>(labelSel)) {
          const g = lab.closest<MozTabGroup>("tab-group");
          if (!g) {
            continue;
          }
          if ((g.label || g.getAttribute("label") || "").trim() === want) {
            return (
              lab.classList.contains(editingClass) &&
              lab.getAttribute("contenteditable") === "true"
            );
          }
        }
        return false;
      },
      S.groupLabel,
      label,
      S.inlineEditingClass,
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
      (labelSel: string, want: string, name: string) => {
        let target: HTMLElement | null = null;
        for (const lab of document.querySelectorAll<HTMLElement>(labelSel)) {
          const g = lab.closest<MozTabGroup>("tab-group");
          if (g && (g.label || g.getAttribute("label") || "").trim() === want) {
            target = lab;
            break;
          }
        }
        if (!target) {
          return false;
        }
        target.focus();
        target.textContent = name;
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
        // Belt and braces: if the element never held focus, blur() above is a
        // no-op, so fire the commit listener directly.
        target.dispatchEvent(new FocusEvent("blur"));
        return true;
      },
      S.groupLabel,
      label,
      newName,
    );
  }

  // ---- modal -------------------------------------------------------------

  async waitForOverlay(): Promise<void> {
    await this.driver.wait(
      async () =>
        (await this.exec(
          (overlayId: string) => !!document.getElementById(overlayId),
          S.overlayId,
        )) === true,
      10_000,
      "modal overlay did not appear",
      150,
    );
  }

  async waitForNoOverlay(): Promise<void> {
    await this.driver.wait(
      async () =>
        (await this.exec(
          (overlayId: string) => !document.getElementById(overlayId),
          S.overlayId,
        )) === true,
      10_000,
      "modal overlay did not close",
      150,
    );
  }

  overlayTitle(): Promise<string | null> {
    return this.exec((titleSel: string) => {
      const t = document.querySelector(titleSel);
      return t ? (t.textContent || "").trim() : null;
    }, S.modalTitle);
  }

  hasModalPasswordField(): Promise<boolean> {
    return this.exec(
      (bodySel: string, inputSel: string) =>
        !!document.querySelector(`${bodySel} ${inputSel}[type=password]`) ||
        !!document.querySelector(`${inputSel}[type=password]`),
      S.modalBody,
      S.input,
    );
  }

  /** Fill the (first) modal text input. */
  async fillModalName(text: string): Promise<void> {
    const sel = `${S.modalBody} ${S.input}`;
    if (
      await this.tryNative(async () => {
        const input = await this.$(sel);
        await input.clear();
        await input.sendKeys(text);
      })
    ) {
      return;
    }
    await this.exec(
      (inputSel: string, value: string) => {
        const el = document.querySelector<HTMLInputElement>(inputSel);
        if (!el) {
          return false;
        }
        el.focus();
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      },
      sel,
      text,
    );
  }

  /** Click the color swatch named `colorName` (its title attribute). */
  async pickSwatch(colorName: string): Promise<void> {
    const sel = `${S.swatch}[title="${colorName}"]`;
    if (await this.tryNative(async () => (await this.$(sel)).click())) {
      return;
    }
    await this.exec((swatchSel: string) => {
      document.querySelector<HTMLElement>(swatchSel)?.click();
      return true;
    }, sel);
  }

  /** Click the primary footer button (Save). */
  async clickPrimary(): Promise<void> {
    const sel = `${S.modalFooter} ${S.btnPrimary}`;
    if (await this.tryNative(async () => (await this.$(sel)).click())) {
      return;
    }
    await this.exec((btnSel: string) => {
      document.querySelector<HTMLElement>(btnSel)?.click();
      return true;
    }, sel);
  }

  async pressEscape(): Promise<void> {
    // chrome context has no switchTo().activeElement(); the modal listens for a
    // capturing keydown on `document`, so dispatch Escape there directly.
    await this.exec(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      return true;
    });
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
    await this.exec((body: string) => {
      if (!window.__zenTidyTabsOrigFetch) {
        window.__zenTidyTabsOrigFetch = window.fetch;
      }
      window.fetch = () =>
        Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      return true;
    }, payload);
  }

  async restoreFetch(): Promise<void> {
    await this.exec(() => {
      if (window.__zenTidyTabsOrigFetch) {
        window.fetch = window.__zenTidyTabsOrigFetch;
        window.__zenTidyTabsOrigFetch = undefined;
      }
      return true;
    });
  }
}

/**
 * Resolve an absolute path to a geckodriver binary, downloading it (once) into
 * a stable project-local cache so we don't refetch on every run. Honors an
 * explicit GECKODRIVER_PATH override.
 */
async function resolveGeckodriver(): Promise<string> {
  const override = process.env.GECKODRIVER_PATH;
  if (override && fs.existsSync(override)) {
    return override;
  }

  const { download } = await import("geckodriver");
  const cacheDir = path.resolve(__dirname, "..", ".geckodriver");
  fs.mkdirSync(cacheDir, { recursive: true });
  // download() returns the absolute path to the (cached or freshly fetched) exe.
  return download(undefined, cacheDir);
}

export { SCRIPT_PATH, STUB_API_KEY, ZEN_BINARY };
