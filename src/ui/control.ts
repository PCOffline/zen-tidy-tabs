import { CONFIG } from "../config";
import { dom, matchesClear } from "../dom";
import { doc, LOAD_TOKEN, win } from "../env";
import { Log } from "../logger";
import { orchestrator } from "../orchestrator";
import { ui } from "./settings";

export const control = {
  build(twin: Element | null): HTMLElement {
    const el = doc.createElement(twin ? twin.tagName : "span");
    el.id = CONFIG.ui.controlId;
    el.textContent = CONFIG.ui.label;
    el.setAttribute("label", CONFIG.ui.label);
    el.setAttribute("tooltiptext", CONFIG.ui.tooltip);
    el.title = CONFIG.ui.tooltip;
    el.className = twin ? twin.className : "zen-tidy-tabs-fallback";
    if (twin) {
      el.classList.remove(CONFIG.ui.clearButtonClass);
      el.dataset.twin = "1";
    }

    const tidy = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      Log.user.debug("Tidy control activated (click / command).");
      orchestrator.runTidy();
    };
    el.addEventListener("click", tidy);
    el.addEventListener("command", tidy);
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      Log.user.debug("Tidy control right-clicked; opening settings.");
      ui.settings();
    });
    return el;
  },

  twinIsCurrent(): boolean {
    const existing = doc.getElementById(CONFIG.ui.controlId);
    if (!(existing?.dataset?.twin === "1" && existing.isConnected)) {
      return false;
    }
    const clear = dom.clearControl();
    return (
      !!clear &&
      existing.parentElement === clear.parentElement &&
      existing.nextElementSibling === clear
    );
  },

  placeTwinIfClearPresent(): boolean {
    if (control.twinIsCurrent()) {
      return true;
    }
    const clear = dom.clearControl();
    if (!clear?.parentElement) {
      return false;
    }
    doc.getElementById(CONFIG.ui.controlId)?.remove();
    clear.parentElement.insertBefore(control.build(clear), clear);
    Log.dom.info(
      `Tidy control mounted as a twin of the Clear button (${dom.describe(clear)}).`,
    );
    return true;
  },

  installClearWatcher(): void {
    const prev = win.__zenTidyTabsClearWatcher;
    if (prev?.token === LOAD_TOKEN) {
      return;
    }
    if (prev) {
      prev.target.removeEventListener("mouseover", prev.handler, true);
    }

    const target = doc.documentElement as HTMLElement;
    const handler = () => {
      const existing = doc.getElementById(CONFIG.ui.controlId);
      if (
        existing?.dataset?.twin === "1" &&
        existing.isConnected &&
        existing.nextElementSibling &&
        matchesClear(existing.nextElementSibling) &&
        dom.activeWorkspaceEl()?.contains(existing)
      ) {
        return;
      }
      control.placeTwinIfClearPresent();
    };
    target.addEventListener("mouseover", handler, true);
    win.__zenTidyTabsClearWatcher = { token: LOAD_TOKEN, target, handler };
    Log.dom.debug(
      "Clear-button hover watcher installed on",
      `${dom.describe(target)}.`,
    );
  },

  installWorkspaceWatcher(): void {
    const prev = win.__zenTidyTabsWorkspaceWatcher;
    if (prev?.token === LOAD_TOKEN) {
      return;
    }
    const zw = win.gZenWorkspaces;
    if (typeof zw?.addChangeListeners !== "function") {
      return;
    }
    if (prev) {
      zw.removeChangeListeners?.(prev.listener);
    }
    const listener = () => control.mount();
    zw.addChangeListeners(listener, { once: false });
    win.__zenTidyTabsWorkspaceWatcher = { token: LOAD_TOKEN, listener };
    Log.dom.debug(
      "Workspace-change watcher installed; Tidy control will follow the active workspace.",
    );
  },

  mount(): boolean {
    control.installClearWatcher();
    control.installWorkspaceWatcher();
    if (control.placeTwinIfClearPresent()) {
      return true;
    }

    const existing = doc.getElementById(CONFIG.ui.controlId);
    const section = dom.activeSection();
    if (existing && section && !section.contains(existing)) {
      existing.remove();
    }

    if (!doc.getElementById(CONFIG.ui.controlId)) {
      const anchor = section && dom.firstNormalNode(section);
      if (anchor?.parentElement) {
        anchor.parentElement.insertBefore(control.build(null), anchor);
        Log.dom.info(
          "Tidy control mounted via separator fallback (hover to reveal; will upgrade to a Clear twin when one appears).",
        );
        return true;
      }
    }

    Log.dom.debug(
      "No mount target available yet; will retry or wait for a hover.",
    );
    return !!doc.getElementById(CONFIG.ui.controlId);
  },

  setBusy(busy: boolean): void {
    const el = doc.getElementById(CONFIG.ui.controlId);
    if (!el) {
      return;
    }
    el.textContent = busy ? CONFIG.ui.busyLabel : CONFIG.ui.label;
    el.setAttribute("label", busy ? CONFIG.ui.busyLabel : CONFIG.ui.label);
    el.style.pointerEvents = busy ? "none" : "";
  },
};
