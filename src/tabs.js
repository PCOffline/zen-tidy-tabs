import { CONFIG } from "./config.js";
import { getGroupName } from "./dom.js";
import { gBrowser, win } from "./env.js";
import { prefs } from "./prefs.js";

export const tabs = {
  collect(includeGrouped) {
    const workspaceId = win.gZenWorkspaces?.activeWorkspace ?? null;
    return gBrowser.tabs.filter((tab) => {
      if (tab.pinned || tab.hidden || tab.closing) {
        return false;
      }
      if (!includeGrouped && tab.group) {
        return false;
      }
      if (
        tab.hasAttribute("zen-empty-tab") ||
        tab.hasAttribute("zen-glance-tab")
      ) {
        return false;
      }
      const tabWorkspace = tab.getAttribute("zen-workspace-id");
      if (workspaceId && tabWorkspace && tabWorkspace !== workspaceId) {
        return false;
      }
      return true;
    });
  },

  isAlive(tab) {
    return (
      tab && !tab.closing && tab.isConnected && gBrowser.tabs.includes(tab)
    );
  },

  title(tab) {
    return (tab.label ?? "").slice(0, CONFIG.snapshot.titleMax);
  },

  formatUrl(spec, mode) {
    if (!spec || mode === "minimal") {
      return "";
    }
    if (mode === "compact") {
      try {
        return new URL(spec).hostname;
      } catch {
        return "";
      }
    }
    return spec.split("?")[0].split("#")[0].slice(0, CONFIG.snapshot.urlMax);
  },

  snapshot(list) {
    const mode = prefs.urlMode();
    return list.map((tab, i) => {
      const entry = { i, title: tabs.title(tab) };
      const url = tabs.formatUrl(
        tab.linkedBrowser?.currentURI?.spec ?? "",
        mode,
      );
      if (url) {
        entry.url = url;
      }
      const group = getGroupName(tab.group);
      if (group) {
        entry.group = group;
      }
      return entry;
    });
  },
};
