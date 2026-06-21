import { CONFIG } from "../config";
import { getGroupName } from "../dom";
import { doc, gBrowser, win } from "../env";
import { groups } from "../groups";
import { Log } from "../logger";

export const nativePanel = {
  customize(): void {
    if (CONFIG.panel.hideSaveAndClose) {
      nativePanel.hideSaveAndClose();
    }
    if (CONFIG.panel.overrideUngroup) {
      nativePanel.installUngroupOverride();
    }
  },

  hideSaveAndClose(): void {
    const btn = doc.getElementById(
      CONFIG.panel.ids.saveAndClose,
    ) as HTMLElement | null;
    if (btn) {
      btn.hidden = true;
    }
  },

  installUngroupOverride(): void {
    if (win.__zenTidyTabsPanelOverride) {
      return;
    }
    const panel = gBrowser.tabGroupMenu?.panel;
    if (!panel) {
      return;
    }
    const onCommand = (e: Event) => {
      if ((e.target as Element)?.id !== CONFIG.panel.ids.ungroup) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      nativePanel.ungroup(gBrowser.tabGroupMenu?.activeGroup);
    };
    panel.addEventListener("command", onCommand, true);
    win.__zenTidyTabsPanelOverride = { panel, onCommand };
    Log.user.debug("Installed 'Ungroup tabs' override on the native panel.");
  },

  uninstall(): void {
    const prev = win.__zenTidyTabsPanelOverride;
    if (!prev) {
      return;
    }
    try {
      prev.panel.removeEventListener("command", prev.onCommand, true);
    } catch {
      /* panel already torn down */
    }
    win.__zenTidyTabsPanelOverride = null;
  },

  ungroup(group: ZenTabGroup | null | undefined): void {
    if (!group) {
      return;
    }
    const name = getGroupName(group);
    const detached = groups.detachAndDissolve(group, `ungrouping "${name}"`);
    try {
      gBrowser.tabGroupMenu?.close?.();
    } catch {
      /* panel may already be gone */
    }
    Log.user.info(`Ungrouped ${detached} tab(s) from "${name}".`);
  },
};
