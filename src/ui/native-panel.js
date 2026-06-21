import { CONFIG } from "../config.js";
import { getGroupName } from "../dom.js";
import { doc, gBrowser, win } from "../env.js";
import { groups } from "../groups.js";
import { Log } from "../logger.js";

export const nativePanel = {
  customize() {
    if (CONFIG.panel.hideSaveAndClose) {
      nativePanel.hideSaveAndClose();
    }
    if (CONFIG.panel.overrideUngroup) {
      nativePanel.installUngroupOverride();
    }
  },

  hideSaveAndClose() {
    const btn = doc.getElementById(CONFIG.panel.ids.saveAndClose);
    if (btn) {
      btn.hidden = true;
    }
  },

  installUngroupOverride() {
    if (win.__zenTidyTabsPanelOverride) {
      return;
    }
    const panel = gBrowser.tabGroupMenu?.panel;
    if (!panel) {
      return;
    }
    const onCommand = (e) => {
      if (e.target?.id !== CONFIG.panel.ids.ungroup) {
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

  uninstall() {
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

  ungroup(group) {
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
