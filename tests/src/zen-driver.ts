import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Builder, By, Key, type WebElement } from "selenium-webdriver";
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

  /** Whether this run is headless. Real pointer/keyboard input is unreliable
   *  headless, so real-input specs skip themselves when this is true. */
  get isHeadless(): boolean {
    return this.headless;
  }

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

      // Mirror dom.clearControl()/matchesClear() exactly: an element whose
      // label or textContent is exactly "clear", or — for a childless element —
      // whose ::before/::after content says "clear". The pseudo-element check is
      // the part the old helper omitted, which could disagree with the script on
      // builds that render Clear's text via CSS and route this test down the
      // wrong branch.
      const findClear = (): Element | null => {
        const sel =
          "toolbarbutton, button, label, span, hbox, vbox, toolbaritem, div, image, [label], [tooltiptext]";
        for (const el of document.querySelectorAll(sel)) {
          if (el === btn) {
            continue;
          }
          if (
            (el.getAttribute("label") || "").trim().toLowerCase() === "clear"
          ) {
            return el;
          }
          if ((el.textContent || "").trim().toLowerCase() === "clear") {
            return el;
          }
          if (el.children.length === 0) {
            for (const pseudo of ["::before", "::after"]) {
              try {
                const content =
                  window.getComputedStyle(el, pseudo).content || "";
                if (/clear/i.test(content)) {
                  return el;
                }
              } catch {
                // detached node
              }
            }
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
   * Reset to a clean single-tab, no-group state, dismiss any open modal, restore
   * the script's four prefs to their suite baseline, and clear notifications.
   * Hermetic setup lives here so a test that changes a pref or leaves a
   * notification up can't leak into the next test if it throws before its
   * `finally`. Safe to call before every test.
   */
  async reset(): Promise<void> {
    await this.restoreFetch();
    await this.exec(
      (cfg: {
        overlayId: string;
        msgValue: string;
        prefs: {
          apiKey: string;
          model: string;
          labelStyle: string;
          urlMode: string;
        };
        defaults: {
          apiKey: string;
          model: string;
          labelStyle: string;
          urlMode: string;
        };
      }) => {
        const overlay = document.getElementById(cfg.overlayId);
        if (overlay) {
          overlay.remove();
        }

        // Keep Zen's original startup tab as the blank keeper instead of opening
        // a fresh tab and closing the original. Closing the startup tab leaves a
        // dangling shutdown blocker that makes a later driver.quit() hang ~60s on
        // Firefox's async-shutdown watchdog; reusing it avoids that entirely.
        const keep = gBrowser.tabs[0];
        if (!keep) {
          return true;
        }
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

        // Restore the four prefs to the suite baseline (a usable stub key, no
        // model override, filled labels, detailed urls).
        Services.prefs.setStringPref(cfg.prefs.apiKey, cfg.defaults.apiKey);
        Services.prefs.setStringPref(cfg.prefs.model, cfg.defaults.model);
        Services.prefs.setStringPref(
          cfg.prefs.labelStyle,
          cfg.defaults.labelStyle,
        );
        Services.prefs.setStringPref(cfg.prefs.urlMode, cfg.defaults.urlMode);

        // Drain any pending notification so the box starts empty.
        try {
          const box = gBrowser.getNotificationBox();
          let note = box.getNotificationWithValue?.(cfg.msgValue);
          let guard = 0;
          while (note && guard++ < 20) {
            box.removeNotification?.(note);
            note = box.getNotificationWithValue?.(cfg.msgValue);
          }
        } catch {
          // notification box unavailable; nothing to clear
        }
        return true;
      },
      {
        overlayId: S.overlayId,
        msgValue: "zen-tidy-tabs-msg",
        prefs: S.prefs,
        defaults: {
          apiKey: STUB_API_KEY,
          model: "",
          labelStyle: "filled",
          urlMode: "detailed",
        },
      },
    );
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

  /** Total number of tabs open in the window, eligible or not. */
  totalTabCount(): Promise<number> {
    return this.exec(() => gBrowser.tabs.length);
  }

  /**
   * Open one pinned tab, one Zen empty tab, and one Zen glance tab -- the three
   * kinds of tab `collect()` must skip (TIDY-3). Resolves with how many tabs
   * were added so a test can assert the total grew while the eligible count did
   * not.
   */
  openIneligibleTabs(): Promise<number> {
    return this.exec(() => {
      const principal = Services.scriptSecurityManager.getSystemPrincipal();
      const add = (attr?: string): MozTab => {
        const url = "data:text/html,<title>Ineligible</title>";
        const tab =
          typeof gBrowser.addTrustedTab === "function"
            ? gBrowser.addTrustedTab(url)
            : gBrowser.addTab(url, { triggeringPrincipal: principal });
        if (attr) {
          tab.setAttribute(attr, "true");
        }
        return tab;
      };
      gBrowser.pinTab(add());
      add("zen-empty-tab");
      add("zen-glance-tab");
      return 3;
    });
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

  /** The `color` of the group whose label === `label`, or "" if none matches. */
  groupColor(label: string): Promise<string> {
    return this.exec((want: string) => {
      for (const g of document.querySelectorAll<MozTabGroup>("tab-group")) {
        const l = (g.label || g.getAttribute("label") || "").trim();
        if (l === want) {
          return (g.color || g.getAttribute("color") || "").trim();
        }
      }
      return "";
    }, label);
  }

  /** Close every tab inside the group whose label === `label`. */
  async closeGroupTabs(label: string): Promise<void> {
    await this.exec((want: string) => {
      for (const g of document.querySelectorAll<MozTabGroup>("tab-group")) {
        if ((g.label || g.getAttribute("label") || "").trim() !== want) {
          continue;
        }
        const list =
          g.tabs || g.querySelectorAll<MozTab>("tab, .tabbrowser-tab");
        for (const t of [...list]) {
          try {
            gBrowser.removeTab(t, { animate: false });
          } catch {
            // best effort: leave tabs that refuse to close
          }
        }
      }
      return true;
    }, label);
  }

  /** currentURI.spec of every open tab (for asserting navigation completed). */
  tabUrlSpecs(): Promise<string[]> {
    return this.exec(() =>
      [...gBrowser.tabs].map((t) => t.linkedBrowser?.currentURI?.spec || ""),
    );
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

  /** Single left click on a group badge (with a dispatched fallback). */
  async clickLabelOnce(label: string): Promise<InteractionKind> {
    const el = await this.labelElement(label);
    if (
      (await this.tryNative(() => el.click())) &&
      (await this.labelEntersEditing(label))
    ) {
      return "native";
    }
    await this.dispatchLabelEvents(label, ["click"]);
    return "dispatched";
  }

  /** Double left click on a group badge (with a dispatched fallback). */
  async doubleClickLabel(label: string): Promise<InteractionKind> {
    const el = await this.labelElement(label);
    if (
      (await this.tryNative(() => this.actions().doubleClick(el).perform())) &&
      (await this.labelEntersEditing(label))
    ) {
      return "native";
    }
    await this.dispatchLabelEvents(label, ["click", "click"]);
    return "dispatched";
  }

  /**
   * Dispatch a faithful right click and report, *in the same chrome call*,
   * whether it brought the inline-rename input into the DOM.
   *
   * The check must be synchronous with the gesture: the script opens the native
   * panel on a deferred tick, and opening it tears any stray inline input back
   * down -- so a separate round-trip (a later {@link inlineInputExists}) would
   * miss the transient input and report a false pass. This is the exact gap that
   * let "right click edits inline" ship green. Returns true if a right click
   * wrongly started an inline edit.
   */
  rightClickStartedInlineEdit(label: string): Promise<boolean> {
    return this.exec(
      (
        groupSel: string,
        labelSel: string,
        inputSel: string,
        want: string,
        seq: Array<{ type: string; button: number }>,
      ) => {
        let group: Element | null = null;
        for (const g of document.querySelectorAll(groupSel)) {
          if (
            (
              (g as MozTabGroup).label ||
              g.getAttribute("label") ||
              ""
            ).trim() === want
          ) {
            group = g;
            break;
          }
        }
        if (!group) {
          return false;
        }
        const target = group.querySelector<HTMLElement>(labelSel);
        if (!target) {
          return false;
        }
        for (const spec of seq) {
          target.dispatchEvent(
            new MouseEvent(spec.type, {
              bubbles: true,
              cancelable: true,
              button: spec.button,
              buttons: spec.button === 2 ? 2 : 1,
            }),
          );
        }
        // Synchronous with the gesture, before the deferred panel-open can tear
        // a stray inline edit down.
        return !!group.querySelector(inputSel);
      },
      "tab-group",
      S.groupLabel,
      S.inlineInput,
      label,
      this.rightClickSequence(),
    );
  }

  /** Fire a rapid burst of `times` left clicks on a badge. */
  async spamClickLabel(label: string, times: number): Promise<InteractionKind> {
    await this.dispatchLabelEvents(
      label,
      Array(times).fill({ type: "click", button: 0 }),
    );
    return "dispatched";
  }

  /** Fire `times` alternating left/right clicks on a badge. */
  async alternateClicksLabel(
    label: string,
    times: number,
  ): Promise<InteractionKind> {
    const gestures = Array.from({ length: times }, (_, i) =>
      i % 2 === 0 ? [{ type: "click", button: 0 }] : this.rightClickSequence(),
    ).flat();
    await this.dispatchLabelEvents(label, gestures);
    return "dispatched";
  }

  /** Poll briefly for the badge to enter inline-edit mode. */
  private async labelEntersEditing(
    label: string,
    timeoutMs = 1500,
  ): Promise<boolean> {
    try {
      await this.driver.wait(
        async () => await this.labelIsEditing(label),
        timeoutMs,
        "badge did not enter inline-edit mode",
        100,
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Dispatch a sequence of mouse events on a badge in chrome context. */
  private async dispatchLabelEvents(
    label: string,
    types: Array<string | { type: string; button: number }>,
  ): Promise<void> {
    await this.exec(
      (
        labelSel: string,
        want: string,
        eventTypes: Array<string | { type: string; button: number }>,
      ) => {
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
        for (const spec of eventTypes) {
          const type = typeof spec === "string" ? spec : spec.type;
          const button = typeof spec === "string" ? 0 : spec.button;
          target.dispatchEvent(
            new MouseEvent(type, {
              bubbles: true,
              cancelable: true,
              button,
              buttons: button === 2 ? 2 : 1,
            }),
          );
        }
        return true;
      },
      S.groupLabel,
      label,
      types,
    );
  }

  /**
   * The full event sequence Gecko fires for a real right click on the XUL
   * badge. Crucially this includes a `click` with `button: 2` -- Gecko
   * dispatches a click for the right button on XUL elements -- which is what a
   * faithful right-click test must reproduce. A naive `contextmenu`-only
   * dispatch hid the bug where a right click also started an inline rename.
   */
  private rightClickSequence(): Array<{ type: string; button: number }> {
    return [
      { type: "mousedown", button: 2 },
      { type: "contextmenu", button: 2 },
      { type: "mouseup", button: 2 },
      { type: "click", button: 2 },
    ];
  }

  /**
   * Width (px) of the live inline input for `label`, and of the tab strip that
   * contains it. Lets a test assert the field hugs its text rather than
   * stretching to fill the sidebar.
   */
  inlineMetrics(label: string): Promise<{ input: number; strip: number }> {
    return this.exec(
      (groupSel: string, inputSel: string, stripSel: string, want: string) => {
        const strip = document.querySelector(stripSel);
        const stripW = strip ? strip.getBoundingClientRect().width : 0;
        for (const g of document.querySelectorAll<MozTabGroup>(groupSel)) {
          if ((g.label || g.getAttribute("label") || "").trim() !== want) {
            continue;
          }
          const input = g.querySelector<HTMLInputElement>(inputSel);
          return {
            input: input ? input.getBoundingClientRect().width : 0,
            strip: stripW,
          };
        }
        return { input: 0, strip: stripW };
      },
      "tab-group",
      S.inlineInput,
      "#tabbrowser-tabs",
      label,
    );
  }

  /**
   * Set the inline input's value and fire `input` (no Enter, no commit), so the
   * field re-sizes to the new text. Used to check grow-with-text behaviour.
   */
  async setInlineValue(label: string, text: string): Promise<void> {
    await this.exec(
      (groupSel: string, inputSel: string, want: string, value: string) => {
        for (const g of document.querySelectorAll<MozTabGroup>(groupSel)) {
          if ((g.label || g.getAttribute("label") || "").trim() !== want) {
            continue;
          }
          const input = g.querySelector<HTMLInputElement>(inputSel);
          if (input) {
            input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
          }
          return;
        }
      },
      "tab-group",
      S.inlineInput,
      label,
      text,
    );
  }

  /**
   * Whether the badge for `label` is currently in inline-edit mode.
   *
   * The inline editor is a real HTML <input> that replaces the (XUL, and so
   * non-editable) label, so "editing" means the input exists and actually holds
   * focus -- the focus check is what the old contenteditable approach silently
   * failed.
   */
  labelIsEditing(label: string): Promise<boolean> {
    return this.exec(
      (groupSel: string, inputSel: string, want: string) => {
        for (const g of document.querySelectorAll<MozTabGroup>(groupSel)) {
          if ((g.label || g.getAttribute("label") || "").trim() !== want) {
            continue;
          }
          const input = g.querySelector<HTMLInputElement>(inputSel);
          return !!input && document.activeElement === input;
        }
        return false;
      },
      "tab-group",
      S.inlineInput,
      label,
    );
  }

  /**
   * Whether the inline-rename <input> exists for `label`, regardless of focus.
   *
   * {@link labelIsEditing} additionally requires the input to hold focus, which
   * doesn't stick under synthetic dispatch -- so a right click that wrongly
   * *creates* the input (then loses focus) reads as "not editing" there. This
   * existence check is what catches that bug: a right click must never bring the
   * inline input into the DOM at all, not even transiently.
   */
  inlineInputExists(label: string): Promise<boolean> {
    return this.exec(
      (groupSel: string, inputSel: string, want: string) => {
        for (const g of document.querySelectorAll<MozTabGroup>(groupSel)) {
          if ((g.label || g.getAttribute("label") || "").trim() !== want) {
            continue;
          }
          return !!g.querySelector(inputSel);
        }
        return false;
      },
      "tab-group",
      S.inlineInput,
      label,
    );
  }

  /** Whether the chrome root carries the inline-edit marker class (BADGE-7). */
  editingRootMarked(): Promise<boolean> {
    return this.exec(() =>
      document.documentElement.classList.contains("zen-tidy-tabs-editing"),
    );
  }

  /** Whether the named group's `tab-group` element is collapsed. */
  groupIsCollapsed(label: string): Promise<boolean> {
    return this.exec(
      (lbl: string) =>
        !!document
          .querySelector(`tab-group[label="${lbl}"]`)
          ?.hasAttribute("collapsed"),
      label,
    );
  }

  /**
   * Dispatch a left click on the active inline-rename input. Mirrors the second
   * click of a double-click, which lands on the input because the badge is
   * hidden behind it (BADGE-8).
   */
  clickInlineInput(): Promise<boolean> {
    return this.exec((inputSel: string) => {
      const input = document.querySelector(inputSel);
      if (!input) {
        return false;
      }
      input.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
      return true;
    }, S.inlineInput);
  }

  /**
   * Whether the script's injected CSS carries the BADGE-7 rule that forces Zen's
   * empty sidebar to `no-drag` while editing. Gecko doesn't expose
   * `-moz-window-dragging` through `getComputedStyle`, so we verify the rule is
   * wired by reading it back from the stylesheet text instead.
   */
  hasDragOverrideRule(): Promise<boolean> {
    return this.exec(() => {
      for (const style of document.querySelectorAll("style")) {
        const css = style.textContent || "";
        if (
          css.includes("zen-tidy-tabs-editing") &&
          css.includes(".zen-workspace-empty-space") &&
          css.includes("-moz-window-dragging")
        ) {
          return true;
        }
      }
      return false;
    });
  }

  /**
   * Type `newName` into the inline editor and commit it with Enter.
   *
   * The editor is a real HTML <input>, so we set its value and dispatch an Enter
   * keydown; the script's keydown handler reads `input.value` and renames the
   * group.
   */
  async commitInlineRename(label: string, newName: string): Promise<void> {
    await this.exec(
      (groupSel: string, inputSel: string, want: string, name: string) => {
        let input: HTMLInputElement | null = null;
        for (const g of document.querySelectorAll<MozTabGroup>(groupSel)) {
          if ((g.label || g.getAttribute("label") || "").trim() === want) {
            input = g.querySelector<HTMLInputElement>(inputSel);
            break;
          }
        }
        if (!input) {
          return false;
        }
        input.focus();
        input.value = name;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
        return true;
      },
      "tab-group",
      S.inlineInput,
      label,
      newName,
    );
  }

  /**
   * Type `typed` into the inline editor, then press Escape. The script's keydown
   * handler discards the edit, so no rename is committed.
   */
  async cancelInlineRename(label: string, typed: string): Promise<void> {
    await this.exec(
      (groupSel: string, inputSel: string, want: string, typedText: string) => {
        let input: HTMLInputElement | null = null;
        for (const g of document.querySelectorAll<MozTabGroup>(groupSel)) {
          if ((g.label || g.getAttribute("label") || "").trim() === want) {
            input = g.querySelector<HTMLInputElement>(inputSel);
            break;
          }
        }
        if (!input) {
          return false;
        }
        input.focus();
        input.value = typedText;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        return true;
      },
      "tab-group",
      S.inlineInput,
      label,
      typed,
    );
  }

  // ---- Zen's native group edit panel -------------------------------------

  /**
   * The state of Zen's native group edit panel: "open", "closed", or null when
   * the panel doesn't exist yet.
   *
   * Right-clicking a badge hands off to `gBrowser.tabGroupMenu.openEditModal`,
   * which opens this real panel. Reading the real `panel.state` (rather than
   * spying the opener) is what proves the hand-off actually surfaced UI -- the
   * exact gap that let "tests pass but manual fails" slip through before.
   */
  editPanelState(): Promise<string | null> {
    return this.exec(() => gBrowser.tabGroupMenu?.panel?.state ?? null);
  }

  /** Whether Zen's native group edit panel is currently open. */
  async editPanelOpen(): Promise<boolean> {
    return (await this.editPanelState()) === "open";
  }

  /** Poll until the native edit panel is open (throws on timeout). */
  async waitForEditPanel(timeoutMs = 5_000): Promise<void> {
    await this.driver.wait(
      async () => await this.editPanelOpen(),
      timeoutMs,
      "Zen's native group edit panel did not open",
      150,
    );
  }

  /** Poll until the native edit panel is open, resolving true/false instead of throwing. */
  async editPanelAppears(timeoutMs = 1_500): Promise<boolean> {
    try {
      await this.waitForEditPanel(timeoutMs);
      return true;
    } catch {
      return false;
    }
  }

  /** Close the native edit panel if it's open. */
  async closeEditPanel(): Promise<void> {
    await this.exec(() => {
      const menu = gBrowser.tabGroupMenu;
      if (!menu) {
        return;
      }
      if (typeof menu.close === "function") {
        menu.close();
      }
      menu.panel?.hidePopup();
    });
    // Wait for the panel to be *fully* closed, not merely not-"open". The panel
    // is a worker-shared singleton, so resolving while it's still in the
    // transitional "hiding" state lets the next test's openPopup race the
    // tear-down and silently drop -- surfacing as "panel did not open".
    await this.driver.wait(
      async () => {
        const state = await this.editPanelState();
        return state === null || state === "closed";
      },
      5_000,
      "Zen's native group edit panel did not fully close",
      150,
    );
  }

  /**
   * Whether the native panel's action button with `id` is hidden.
   *
   * The script hides the redundant "Save and close group" action (PANEL-3) by
   * setting `hidden` on Zen's `#tabGroupEditor_saveAndCloseGroup` toolbarbutton,
   * so this reads that element's hidden state directly.
   */
  nativePanelButtonHidden(id: string): Promise<boolean> {
    return this.exec((buttonId: string) => {
      const el = document.getElementById(buttonId);
      if (!el) {
        return false;
      }
      return (
        (el as { hidden?: boolean }).hidden === true ||
        el.getAttribute("hidden") === "true"
      );
    }, id);
  }

  /** Whether the native panel's action button with `id` exists in the DOM. */
  nativePanelButtonExists(id: string): Promise<boolean> {
    return this.exec(
      (buttonId: string) => !!document.getElementById(buttonId),
      id,
    );
  }

  /**
   * Fire a `command` on the native panel's action button with `id`, the same
   * event a real activation dispatches. Bubbles so the script's capture-phase
   * override on the panel sees it (PANEL-4).
   */
  async activatePanelButton(id: string): Promise<void> {
    await this.exec((buttonId: string) => {
      const el = document.getElementById(buttonId);
      if (!el) {
        return false;
      }
      el.dispatchEvent(
        new Event("command", { bubbles: true, cancelable: true }),
      );
      return true;
    }, id);
  }

  /**
   * Dispatch a real `contextmenu` on the live inline input for `label`.
   *
   * Mid-rename the badge shows our HTML input (the XUL label is hidden), so a
   * right click lands on the input, not the label. This drives that exact
   * target to prove the script still hands off to the native panel -- the #3
   * fix -- without depending on the flaky OS-pointer focus that a real
   * `contextClick` needs across a long suite.
   */
  rightClickInlineInput(label: string): Promise<boolean> {
    return this.exec(
      (groupSel: string, inputSel: string, want: string) => {
        for (const g of document.querySelectorAll<MozTabGroup>(groupSel)) {
          if ((g.label || g.getAttribute("label") || "").trim() !== want) {
            continue;
          }
          const input = g.querySelector<HTMLInputElement>(inputSel);
          if (!input) {
            return false;
          }
          input.dispatchEvent(
            new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
          );
          return true;
        }
        return false;
      },
      "tab-group",
      S.inlineInput,
      label,
    );
  }

  // ---- real (headed-only) pointer + keyboard input -----------------------

  /** Raise/focus the Zen chrome window so real pointer input lands reliably. */
  private async focusWindow(): Promise<void> {
    await this.exec(() => window.focus());
  }

  /**
   * Real left click on a badge via the WebDriver pointer, then type `newName`
   * and commit it with a real Enter key.
   *
   * This drives the exact path a person takes -- click, type, Enter -- with no
   * dispatched-event shortcuts, so it can catch real-only regressions (e.g. the
   * XUL label ignoring focus) that synthetic events would paper over. Headed
   * only; native input is unreliable headless.
   */
  async realRenameInline(label: string, newName: string): Promise<void> {
    await this.focusWindow();
    const labelEl = await this.labelElement(label);
    await labelEl.click();
    const input = await this.$(S.inlineInput);
    await input.sendKeys(newName);
    await input.sendKeys(Key.ENTER);
  }

  /** Real left click on a badge (no typing). Headed only. */
  async realClickLabel(label: string): Promise<void> {
    await this.focusWindow();
    const labelEl = await this.labelElement(label);
    await labelEl.click();
  }

  /** Type into the active inline-rename input, replacing the selected text. */
  async typeInline(text: string): Promise<void> {
    const input = await this.$(S.inlineInput);
    await input.sendKeys(text);
  }

  /**
   * Real left click on the tab strip's scrollbox -- a non-focusable XUL
   * element. Clicking a non-focusable element doesn't blur the HTML input, so
   * this is the case that only the document `mousedown` handler can dismiss; a
   * focusable target (a tab, the urlbar) would close via blur and hide the bug.
   * Headed only.
   */
  async realClickAway(): Promise<void> {
    await this.focusWindow();
    const strip = await this.$("#tabbrowser-arrowscrollbox");
    await strip.click();
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

  /** Whether the modal overlay is currently present in the DOM. */
  overlayExists(): Promise<boolean> {
    return this.exec(
      (overlayId: string) => !!document.getElementById(overlayId),
      S.overlayId,
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

  // ---- settings modal ----------------------------------------------------

  /** Fill the settings modal's API-key (password) and/or model (text) input. */
  async fillSettings(values: {
    apiKey?: string;
    model?: string;
  }): Promise<void> {
    await this.exec(
      (
        bodySel: string,
        inputSel: string,
        apiKey: string | null,
        model: string | null,
      ) => {
        const inputs = [
          ...document.querySelectorAll<HTMLInputElement>(
            `${bodySel} ${inputSel}`,
          ),
        ];
        const fill = (el: HTMLInputElement | undefined, v: string | null) => {
          if (!el || v === null) {
            return;
          }
          el.focus();
          el.value = v;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        };
        fill(
          inputs.find((i) => i.type === "password"),
          apiKey,
        );
        fill(
          inputs.find((i) => i.type !== "password"),
          model,
        );
        return true;
      },
      S.modalBody,
      S.input,
      values.apiKey ?? null,
      values.model ?? null,
    );
  }

  /** Click the segmented-control option whose visible text === `text`. */
  async selectSegment(text: string): Promise<void> {
    await this.exec(
      (segSel: string, want: string) => {
        for (const b of document.querySelectorAll<HTMLElement>(segSel)) {
          if ((b.textContent || "").trim() === want) {
            b.click();
            return true;
          }
        }
        return false;
      },
      S.segButton,
      text,
    );
  }

  /** Current values of the settings modal's API-key and model inputs. */
  settingsInputValues(): Promise<{ apiKey: string; model: string }> {
    return this.exec(
      (bodySel: string, inputSel: string) => {
        const inputs = [
          ...document.querySelectorAll<HTMLInputElement>(
            `${bodySel} ${inputSel}`,
          ),
        ];
        const key = inputs.find((i) => i.type === "password");
        const model = inputs.find((i) => i.type !== "password");
        return { apiKey: key?.value ?? "", model: model?.value ?? "" };
      },
      S.modalBody,
      S.input,
    );
  }

  /** Visible text of every active (selected) segmented-control option. */
  activeSegments(): Promise<string[]> {
    return this.exec(
      (segSel: string) =>
        [...document.querySelectorAll<HTMLElement>(`${segSel}.active`)].map(
          (b) => (b.textContent || "").trim(),
        ),
      S.segButton,
    );
  }

  /** Click the modal's "Cancel" (ghost) button. */
  async clickCancel(): Promise<void> {
    await this.exec(() => {
      document
        .querySelector<HTMLButtonElement>(".zen-tidy-tabs-btn.ghost")
        ?.click();
      return true;
    });
  }

  /** Click the modal's "✕" close button. */
  async clickModalClose(): Promise<void> {
    await this.exec(() => {
      document
        .querySelector<HTMLButtonElement>(".zen-tidy-tabs-modal-close")
        ?.click();
      return true;
    });
  }

  /** Press the mouse on the overlay backdrop (outside the panel) to dismiss. */
  async clickOutsideModal(): Promise<void> {
    await this.exec((overlayId: string) => {
      const overlay = document.getElementById(overlayId);
      // The handler only closes when e.target === overlay, so dispatch directly
      // on the overlay element rather than a descendant.
      overlay?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      return true;
    }, S.overlayId);
  }

  /**
   * Exercise the modal's Tab focus trap in-page: from the last focusable
   * element, Tab should wrap to the first; from the first, Shift+Tab should
   * wrap to the last.
   */
  modalFocusTrap(): Promise<{ forward: boolean; backward: boolean }> {
    return this.exec((panelSel: string) => {
      const panel = document.querySelector(panelSel);
      if (!panel) {
        return { forward: false, backward: false };
      }
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>(
          "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
        ),
      ].filter(
        (el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null,
      );
      if (focusable.length < 2) {
        return { forward: false, backward: false };
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        return { forward: false, backward: false };
      }
      last.focus();
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );
      const forward = document.activeElement === first;
      first.focus();
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      const backward = document.activeElement === last;
      return { forward, backward };
    }, S.modal);
  }

  // ---- preferences -------------------------------------------------------

  /** Read a string preference (the script persists settings via Services.prefs). */
  readPref(name: string): Promise<string> {
    return this.exec((pref: string) => {
      try {
        return Services.prefs.getStringPref(pref, "");
      } catch {
        return "";
      }
    }, name);
  }

  /** Write a string preference (used to restore state after a test). */
  async setPref(name: string, value: string): Promise<void> {
    await this.exec(
      (pref: string, v: string) => {
        Services.prefs.setStringPref(pref, v);
        return true;
      },
      name,
      value,
    );
  }

  // ---- tidy run / snapshot / appearance ----------------------------------

  /** Trigger a tidy run programmatically (window.zenTidyTabs.run()). */
  async runTidy(): Promise<void> {
    await this.exec(() => {
      window.zenTidyTabs.run();
      return true;
    });
  }

  /** The Tidy control's current label text and inline pointer-events value. */
  buttonBusyState(): Promise<{ label: string; pointerEvents: string }> {
    return this.exec((id: string) => {
      const el = document.getElementById(id);
      if (!el) {
        return { label: "", pointerEvents: "" };
      }
      return {
        label: (el.textContent || "").trim(),
        pointerEvents: (el as HTMLElement).style.pointerEvents,
      };
    }, S.buttonId);
  }

  /** Text of the script's current notification (value "zen-tidy-tabs-msg"), or null. */
  lastNotification(): Promise<string | null> {
    return this.exec(() => {
      try {
        const box = gBrowser.getNotificationBox();
        const note = box.getNotificationWithValue?.("zen-tidy-tabs-msg");
        if (!note) {
          return null;
        }
        return (
          note.messageText?.textContent ??
          note.label ??
          note.getAttribute?.("label") ??
          null
        );
      } catch {
        return null;
      }
    });
  }

  /** Remove any of the script's notifications so a test starts from a clean box. */
  async clearNotifications(): Promise<void> {
    await this.exec(() => {
      try {
        const box = gBrowser.getNotificationBox();
        let note = box.getNotificationWithValue?.("zen-tidy-tabs-msg");
        let guard = 0;
        while (note && guard++ < 20) {
          box.removeNotification?.(note);
          note = box.getNotificationWithValue?.("zen-tidy-tabs-msg");
        }
      } catch {
        // notification box unavailable; nothing to clear
      }
      return true;
    });
  }

  /** Open ungrouped tabs at the exact URLs given; wait until they are eligible. */
  async openTabsRaw(urls: string[]): Promise<void> {
    await this.exec((list: string[]) => {
      const principal = Services.scriptSecurityManager.getSystemPrincipal();
      for (const url of list) {
        if (typeof gBrowser.addTrustedTab === "function") {
          gBrowser.addTrustedTab(url);
        } else {
          gBrowser.addTab(url, { triggeringPrincipal: principal });
        }
      }
      return true;
    }, urls);
    await this.driver.wait(
      async () => (await this.collectCount()) >= urls.length,
      15_000,
      `fewer than ${urls.length} eligible tabs after opening`,
      300,
    );
  }

  /** Re-inject the script's stylesheet (window.zenTidyTabs.injectStyles()). */
  async injectStyles(): Promise<void> {
    await this.exec(() => {
      window.zenTidyTabs.injectStyles();
      return true;
    });
  }

  /** Full text of the script's injected <style> element. */
  injectedStyleText(): Promise<string> {
    return this.exec(
      (id: string) => document.getElementById(id)?.textContent ?? "",
      S.styleId,
    );
  }

  /** Computed value of `prop` on the first rendered group label, or "". */
  groupLabelComputed(prop: string): Promise<string> {
    return this.exec(
      (sel: string, p: string) => {
        const el = document.querySelector(sel);
        if (!el) {
          return "";
        }
        return window.getComputedStyle(el).getPropertyValue(p).trim();
      },
      S.groupLabel,
      prop,
    );
  }

  // ---- network stub ------------------------------------------------------

  /**
   * Replace the chrome window's fetch with one that returns a canned
   * OpenRouter chat-completion whose content is `grouping` (a {groups:[...]} obj).
   *
   * Every call records the request body on `window.__zenTidyTabsLastBody` so a
   * test can inspect the snapshot/prompt the script sent (TIDY-5, TIDY-6).
   * With `{ defer: true }` the stub holds the response open until `releaseFetch()`
   * is called, so a test can observe the in-flight state (CONTROL-4, TIDY-2).
   */
  async installFetchStub(
    grouping: GroupingPlan,
    opts: { defer?: boolean } = {},
  ): Promise<void> {
    await this.installFetchRawStub(JSON.stringify(grouping), opts);
  }

  /**
   * Like {@link installFetchStub} but the assistant message content is the exact
   * string given, so a test can feed deliberately malformed (but HTTP-200)
   * model output — e.g. a non-string group name or string/number indices.
   */
  async installFetchRawStub(
    content: string,
    opts: { defer?: boolean } = {},
  ): Promise<void> {
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
    await this.exec(
      (body: string, defer: boolean) => {
        if (!window.__zenTidyTabsOrigFetch) {
          window.__zenTidyTabsOrigFetch = window.fetch;
        }
        window.__zenTidyTabsFetchCalls = 0;
        window.__zenTidyTabsLastBody = null;
        window.__zenTidyTabsRelease = undefined;
        window.fetch = (_url: unknown, init?: { body?: unknown }) => {
          window.__zenTidyTabsFetchCalls =
            (window.__zenTidyTabsFetchCalls ?? 0) + 1;
          window.__zenTidyTabsLastBody =
            init?.body == null ? null : String(init.body);
          const respond = () =>
            new Response(body, {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          if (defer) {
            return new Promise<Response>((resolve) => {
              window.__zenTidyTabsRelease = () => resolve(respond());
            });
          }
          return Promise.resolve(respond());
        };
        return true;
      },
      payload,
      !!opts.defer,
    );
  }

  /**
   * Replace fetch with one that returns an HTTP error, so a run fails inside
   * ai.post() and the orchestrator surfaces a failure notification (TIDY-10).
   */
  async installFetchErrorStub(
    status = 500,
    body = "stub error",
  ): Promise<void> {
    await this.exec(
      (errStatus: number, errBody: string) => {
        if (!window.__zenTidyTabsOrigFetch) {
          window.__zenTidyTabsOrigFetch = window.fetch;
        }
        window.__zenTidyTabsFetchCalls = 0;
        window.fetch = () => {
          window.__zenTidyTabsFetchCalls =
            (window.__zenTidyTabsFetchCalls ?? 0) + 1;
          return Promise.resolve(
            new Response(errBody, {
              status: errStatus,
              headers: { "Content-Type": "text/plain" },
            }),
          );
        };
        return true;
      },
      status,
      body,
    );
  }

  /**
   * Replace fetch with one whose reply is cut off by the output token limit:
   * `finish_reason: "length"` with partial, unparseable JSON content. The run
   * must fail with a truncation-specific message (TIDY-17).
   */
  async installFetchTruncatedStub(): Promise<void> {
    const payload = JSON.stringify({
      id: "zen-tidy-tabs-stub",
      model: "zen-tidy-tabs-stub",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: '{"groups":[{"name":"Partial","tabs":[0,1',
          },
          finish_reason: "length",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
    await this.exec((body: string) => {
      if (!window.__zenTidyTabsOrigFetch) {
        window.__zenTidyTabsOrigFetch = window.fetch;
      }
      window.__zenTidyTabsFetchCalls = 0;
      window.__zenTidyTabsLastBody = null;
      window.fetch = (_url: unknown, init?: { body?: unknown }) => {
        window.__zenTidyTabsFetchCalls =
          (window.__zenTidyTabsFetchCalls ?? 0) + 1;
        window.__zenTidyTabsLastBody =
          init?.body == null ? null : String(init.body);
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      };
      return true;
    }, payload);
  }

  /**
   * Replace fetch with one that returns a reasoning-only reply: empty
   * `content` but non-empty `message.reasoning` (as some router models do).
   * The run must reject it as an empty completion (TIDY-17), never parse the
   * reasoning prose as JSON — even though that prose contains a `{...}` block.
   */
  async installFetchReasoningStub(): Promise<void> {
    const payload = JSON.stringify({
      id: "zen-tidy-tabs-stub",
      model: "zen-tidy-tabs-stub",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "",
            reasoning:
              'Let me think. I could group these as {"groups":[{"name":"Draft","tabs":[0,1]}]} but I am not sure yet.',
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
    await this.exec((body: string) => {
      if (!window.__zenTidyTabsOrigFetch) {
        window.__zenTidyTabsOrigFetch = window.fetch;
      }
      window.__zenTidyTabsFetchCalls = 0;
      window.__zenTidyTabsLastBody = null;
      window.fetch = (_url: unknown, init?: { body?: unknown }) => {
        window.__zenTidyTabsFetchCalls =
          (window.__zenTidyTabsFetchCalls ?? 0) + 1;
        window.__zenTidyTabsLastBody =
          init?.body == null ? null : String(init.body);
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      };
      return true;
    }, payload);
  }

  /**
   * Replace fetch with one that rejects the first request with HTTP 400 (as a
   * provider that does not support `response_format: json_schema` would), then
   * succeeds on every subsequent request with `grouping`. Exercises the
   * `json_schema → json_object → none` degradation (TIDY-16).
   */
  async installFetchRejectThenSucceedStub(
    grouping: GroupingPlan,
    rejectBody = "response_format.json_schema is not supported by this model",
  ): Promise<void> {
    const content = JSON.stringify(grouping);
    const success = JSON.stringify({
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
    await this.exec(
      (okBody: string, errBody: string) => {
        if (!window.__zenTidyTabsOrigFetch) {
          window.__zenTidyTabsOrigFetch = window.fetch;
        }
        window.__zenTidyTabsFetchCalls = 0;
        window.__zenTidyTabsLastBody = null;
        window.fetch = (_url: unknown, init?: { body?: unknown }) => {
          const n = (window.__zenTidyTabsFetchCalls ?? 0) + 1;
          window.__zenTidyTabsFetchCalls = n;
          window.__zenTidyTabsLastBody =
            init?.body == null ? null : String(init.body);
          if (n === 1) {
            return Promise.resolve(
              new Response(errBody, {
                status: 400,
                headers: { "Content-Type": "text/plain" },
              }),
            );
          }
          return Promise.resolve(
            new Response(okBody, {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        };
        return true;
      },
      success,
      rejectBody,
    );
  }

  /** Release a deferred fetch stub installed with `{ defer: true }`. */
  async releaseFetch(): Promise<void> {
    await this.exec(() => {
      window.__zenTidyTabsRelease?.();
      return true;
    });
  }

  /** Raw body of the most recent stubbed fetch request, or null. */
  lastRequestBody(): Promise<string | null> {
    return this.exec(() => window.__zenTidyTabsLastBody ?? null);
  }

  /** The user-message prompt text of the most recent stubbed request. */
  async lastRequestPrompt(): Promise<string> {
    const body = await this.lastRequestBody();
    if (!body) {
      throw new Error("no request body was captured by the fetch stub");
    }
    const parsed = JSON.parse(body) as {
      messages?: { role: string; content: string }[];
    };
    const messages = parsed.messages ?? [];
    if (messages.length === 0) {
      throw new Error("captured request had no messages");
    }
    // The instructions live in the system message and the snapshot in the user
    // message (TIDY-18); join them so prompt/snapshot assertions see both.
    return messages.map((m) => m.content).join("\n");
  }

  /** Parsed JSON of the most recent stubbed request body (TIDY-15, TIDY-16, TIDY-18). */
  async lastRequestJson(): Promise<{
    messages?: { role: string; content: string }[];
    temperature?: number;
    seed?: number;
    max_tokens?: number;
    response_format?: {
      type?: string;
      json_schema?: { name?: string; strict?: boolean; schema?: unknown };
    };
  }> {
    const body = await this.lastRequestBody();
    if (!body) {
      throw new Error("no request body was captured by the fetch stub");
    }
    return JSON.parse(body);
  }

  /** The `<tabs>` snapshot array embedded in the most recent request prompt. */
  async lastRequestSnapshot(): Promise<
    { i: number; title: string; url?: string; group?: string }[]
  > {
    const prompt = await this.lastRequestPrompt();
    const match = prompt.match(/<tabs>\s*([\s\S]*?)\s*<\/tabs>/);
    if (!match || match[1] === undefined) {
      throw new Error("prompt did not contain a <tabs> snapshot block");
    }
    return JSON.parse(match[1]);
  }

  /** How many times the installed fetch stub has been invoked. */
  fetchStubCallCount(): Promise<number> {
    return this.exec(() => window.__zenTidyTabsFetchCalls ?? 0);
  }

  async restoreFetch(): Promise<void> {
    await this.exec(() => {
      if (window.__zenTidyTabsOrigFetch) {
        window.fetch = window.__zenTidyTabsOrigFetch;
        window.__zenTidyTabsOrigFetch = undefined;
      }
      window.__zenTidyTabsFetchCalls = 0;
      window.__zenTidyTabsLastBody = null;
      window.__zenTidyTabsRelease = undefined;
      return true;
    });
  }

  // ---- CONTROL-6: Clear control-class hijack ------------------------------

  /**
   * Mirror Zen's own first-match `querySelector` for its Clear control class,
   * scoped to the active workspace. Reports whether a Clear control exists,
   * whether the Tidy twin (wrongly) carries Zen's control class, and whether
   * that first match resolves to the twin instead of the real Clear. After the
   * CONTROL-6 fix the twin must not carry the class and the first match must be
   * the real Clear.
   */
  clearTwinReport(): Promise<{
    hasClear: boolean;
    tidyHasClearClass: boolean;
    firstMatchIsTidy: boolean;
  }> {
    return this.exec(
      (buttonId: string, clearClass: string, workspaceSel: string) => {
        const scope: Element | Document =
          (typeof gZenWorkspaces !== "undefined" &&
            gZenWorkspaces.activeWorkspaceElement) ||
          document.querySelector(`${workspaceSel}[active]`) ||
          document.querySelector(workspaceSel) ||
          document;
        const twin = document.getElementById(buttonId);
        const firstMatch = scope.querySelector(`.${clearClass}`);
        return {
          hasClear: !!firstMatch,
          tidyHasClearClass: !!twin && twin.classList.contains(clearClass),
          firstMatchIsTidy: !!firstMatch && firstMatch === twin,
        };
      },
      S.buttonId,
      S.clearControlClass,
      S.workspaceEl,
    );
  }

  // ---- CONTROL-7: per-workspace presence ----------------------------------

  /** Whether Zen's workspace API is present and usable in this build. */
  workspacesAvailable(): Promise<boolean> {
    return this.exec(
      () =>
        typeof gZenWorkspaces !== "undefined" &&
        typeof gZenWorkspaces.addChangeListeners === "function" &&
        typeof gZenWorkspaces.createAndSaveWorkspace === "function" &&
        typeof gZenWorkspaces.changeWorkspaceWithID === "function",
    );
  }

  /** UUID of the active workspace. */
  activeWorkspaceId(): Promise<string> {
    return this.exec(() => gZenWorkspaces.activeWorkspace);
  }

  /** Create + save a workspace (Zen auto-switches to it); returns its UUID. */
  async createWorkspace(name: string): Promise<string> {
    // `executeScript` awaits a returned promise, so flatten it with `await`.
    return await this.exec(async (wsName: string) => {
      const ws = await gZenWorkspaces.createAndSaveWorkspace(wsName);
      return ws.uuid;
    }, name);
  }

  /** Switch to the workspace with the given UUID. */
  async switchWorkspace(uuid: string): Promise<void> {
    await this.exec(async (id: string) => {
      await gZenWorkspaces.changeWorkspaceWithID(id);
      return true;
    }, uuid);
  }

  /** Remove the workspace with the given UUID (cleanup). */
  async removeWorkspace(uuid: string): Promise<void> {
    await this.exec(async (id: string) => {
      await gZenWorkspaces.removeWorkspace(id);
      return true;
    }, uuid);
  }

  /** Whether the single Tidy control lives inside the active workspace element. */
  buttonInActiveWorkspace(): Promise<boolean> {
    return this.exec(
      (buttonId: string, workspaceSel: string) => {
        const btn = document.getElementById(buttonId);
        if (!btn) {
          return false;
        }
        const active: Element | null =
          (typeof gZenWorkspaces !== "undefined" &&
            gZenWorkspaces.activeWorkspaceElement) ||
          document.querySelector(`${workspaceSel}[active]`) ||
          document.querySelector(workspaceSel);
        // No identifiable workspace element: fall back to mere existence.
        if (!active) {
          return true;
        }
        return active.contains(btn);
      },
      S.buttonId,
      S.workspaceEl,
    );
  }

  /** Wait until the Tidy control is present in the active workspace, nudging mount(). */
  async waitForButtonInActiveWorkspace(): Promise<void> {
    await this.driver.wait(
      async () => {
        if (await this.buttonInActiveWorkspace()) {
          return true;
        }
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
      "Tidy control never appeared in the active workspace",
      400,
    );
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
