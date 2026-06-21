import { CONFIG } from "./config";
import { getGroupName } from "./dom";
import { gBrowser, win } from "./env";
import { prefs, type UrlMode } from "./prefs";

export interface TabSnapshot {
  i: number;
  title: string;
  url?: string;
  group?: string;
}

export const tabs = {
  collect(includeGrouped: boolean): ZenTab[] {
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

  isAlive(tab: ZenTab): boolean {
    return (
      tab && !tab.closing && tab.isConnected && gBrowser.tabs.includes(tab)
    );
  },

  title(tab: ZenTab): string {
    return (tab.label ?? "").slice(0, CONFIG.snapshot.titleMax);
  },

  formatUrl(spec: string, mode: UrlMode): string {
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
    return (
      (spec.split("?")[0] ?? "")
        .split("#")[0]
        ?.slice(0, CONFIG.snapshot.urlMax) ?? ""
    );
  },

  snapshot(list: ZenTab[]): TabSnapshot[] {
    const mode = prefs.urlMode();
    return list.map((tab, i) => {
      const entry: TabSnapshot = { i, title: tabs.title(tab) };
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
