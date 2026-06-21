import type { GroupPlan } from "./ai";
import { CONFIG } from "./config";
import {
  dom,
  getGroupColor,
  getGroupName,
  getGroupTabs,
  normalizeName,
  setGroupColor,
  setGroupName,
} from "./dom";
import { doc, gBrowser, win } from "./env";
import { Log } from "./logger";
import { tabs } from "./tabs";

export interface ReconcileTally {
  realized: number;
  failed: number;
}

export const groups = {
  create(members: ZenTab[], label: string, color: string): boolean {
    if (typeof gBrowser.ungroupTab === "function") {
      members
        .filter((tab) => tab.group)
        .forEach((tab) => {
          try {
            gBrowser.ungroupTab(tab);
          } catch (e) {
            Log.groups.debug(
              "Failed to detach a tab from its current group before regrouping:",
              (e as Error)?.message,
            );
          }
        });
    }

    const anchor = members[0];
    const attempts = [
      { label, color, insertBefore: anchor },
      { label, color },
      { label, color, isUserTriggered: true },
    ];
    for (const options of attempts) {
      try {
        const group = gBrowser.addTabGroup(members, options);
        if (!group) {
          continue;
        }
        try {
          if (label) {
            setGroupName(group, label);
          }
          if (color) {
            setGroupColor(group, color);
          }
        } catch {
          // Non-fatal: group may reject property writes
        }
        return true;
      } catch (e) {
        Log.groups.debug(
          `addTabGroup attempt failed for group "${label}":`,
          (e as Error)?.message,
        );
      }
    }
    Log.groups.error(
      `Failed to create tab group "${label}" after ${attempts.length} attempts (${members.length} tab(s)).`,
    );
    return false;
  },

  apply(plan: GroupPlan[]): ReconcileTally {
    if (typeof gBrowser.addTabGroup !== "function") {
      throw new Error("gBrowser.addTabGroup is unavailable in this Zen build.");
    }
    return groups.reconcile(plan, groups.existingFor(plan));
  },

  existingFor(plan: GroupPlan[]): Map<string, ZenTabGroup> {
    const map = new Map<string, ZenTabGroup>();
    for (const group of plan) {
      for (const tab of group.tabs) {
        if (!tabs.isAlive(tab)) {
          continue;
        }
        const el = tab.group;
        if (!el) {
          continue;
        }
        const key = normalizeName(getGroupName(el));
        if (key && !map.has(key)) {
          map.set(key, el);
        }
      }
    }
    return map;
  },

  reconcile(
    plan: GroupPlan[],
    existing: Map<string, ZenTabGroup>,
  ): ReconcileTally {
    const tally: ReconcileTally = { realized: 0, failed: 0 };
    const usedColors = new Set<string>();
    const palette = CONFIG.grouping.colors;
    let paletteIndex = 0;
    const nextColor = (): string => {
      for (let i = 0; i < palette.length; i++) {
        const candidate = palette[
          (paletteIndex + i) % palette.length
        ] as string;
        if (!usedColors.has(candidate)) {
          paletteIndex += i + 1;
          usedColors.add(candidate);
          return candidate;
        }
      }
      const fallback = palette[paletteIndex % palette.length] as string;
      paletteIndex++;
      usedColors.add(fallback);
      return fallback;
    };

    const planNames = new Set(plan.map((group) => normalizeName(group.name)));
    for (const [name, el] of existing) {
      if (planNames.has(name)) {
        continue;
      }
      groups.dissolve(el);
    }

    for (const group of plan) {
      const el = existing.get(normalizeName(group.name));
      if (el && typeof el.addTabs === "function") {
        usedColors.add(getGroupColor(el));
      }
    }

    for (const group of plan) {
      const live = group.tabs.filter(tabs.isAlive);
      const dropped = group.tabs.length - live.length;
      if (dropped) {
        Log.groups.warn(
          `Group "${group.name}": ${dropped} tab(s) were closed during the tidy and will be skipped.`,
        );
      }
      if (live.length === 0) {
        Log.groups.debug(
          `Group "${group.name}" has no live tabs after filtering; skipping.`,
        );
        continue;
      }

      const el = existing.get(normalizeName(group.name));
      if (el && typeof el.addTabs === "function") {
        const toAdd = live.filter((tab) => tab.group !== el);
        if (toAdd.length > 0) {
          Log.groups.debug(
            `Reusing existing group "${group.name}" in place; adding ${toAdd.length} tab(s).`,
          );
          try {
            el.addTabs(toAdd);
          } catch (e) {
            Log.groups.warn(
              `Failed to add tabs to existing group "${group.name}".`,
              e,
            );
          }
        }
        tally.realized++;
      } else {
        const color = nextColor();
        Log.groups.debug(
          `Creating new group "${group.name}" with ${live.length} tab(s) (color: ${color}).`,
        );
        if (groups.create(live, group.name, color)) {
          tally.realized++;
        } else {
          tally.failed++;
        }
      }
    }
    return tally;
  },

  detachAndDissolve(el: ZenTabGroup, stage: string): number {
    const members = ([...getGroupTabs(el)] as ZenTab[]).filter(tabs.isAlive);
    if (typeof gBrowser.ungroupTab === "function") {
      members.forEach((tab) => {
        try {
          gBrowser.ungroupTab(tab);
        } catch (e) {
          Log.groups.debug(
            `Failed to detach a tab while ${stage}:`,
            (e as Error)?.message,
          );
        }
      });
    }
    if (groups.hasLiveTabs(el)) {
      return members.length;
    }
    try {
      gBrowser.removeTabGroup(el);
    } catch (e) {
      Log.groups.debug(
        `removeTabGroup failed while ${stage}:`,
        (e as Error)?.message,
      );
    }
    if (el.isConnected) {
      try {
        el.remove();
      } catch {
        // Element may already be disconnected
      }
    }
    return members.length;
  },

  dissolve(el: ZenTabGroup): void {
    try {
      el.label = "";
      el.removeAttribute?.("label");
    } catch {
      // Element may reject property writes
    }
    groups.detachAndDissolve(el, "dissolving an abandoned group");
  },

  hasLiveTabs(groupEl: ZenTabGroup): boolean {
    return ([...getGroupTabs(groupEl)] as ZenTab[]).some(tabs.isAlive);
  },

  removeEmpty(): number {
    const section = dom.activeSection() || doc;
    let removed = 0;

    for (const groupEl of [
      ...section.querySelectorAll("tab-group"),
    ] as ZenTabGroup[]) {
      if (groups.hasLiveTabs(groupEl)) {
        continue;
      }
      if (groupEl.querySelector?.(".zen-tidy-tabs-inline-editing")) {
        continue;
      }

      try {
        if (typeof gBrowser.removeTabGroup === "function") {
          gBrowser.removeTabGroup(groupEl);
        } else {
          groupEl.remove();
        }
        removed++;
      } catch (e) {
        try {
          groupEl.remove();
          removed++;
        } catch {
          Log.groups.warn(
            "Could not remove an empty tab group via API or direct DOM removal.",
            e,
          );
        }
      }
    }

    if (removed) {
      Log.groups.debug(
        `Removed ${removed} empty group(s) from the active workspace.`,
      );
    }
    return removed;
  },

  scheduleEmptyCheck(): void {
    let tries = 0;
    const tick = () => {
      groups.removeEmpty();
      if (++tries < CONFIG.timing.emptyCheckMaxTries) {
        setTimeout(tick, CONFIG.timing.emptyCheckIntervalMs);
      }
    };
    setTimeout(tick, CONFIG.timing.emptyCheckDelayMs);
  },

  installEmptyWatcher(): void {
    win.__zenTidyTabsEmptyWatcher?.disconnect?.();
    const root = doc.getElementById("tabbrowser-tabs") || doc.documentElement;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      if (pending) {
        return;
      }
      pending = setTimeout(() => {
        pending = null;
        groups.removeEmpty();
      }, CONFIG.timing.emptyWatcherDebounceMs);
    });
    observer.observe(root, { childList: true, subtree: true });
    win.__zenTidyTabsEmptyWatcher = observer;
    Log.groups.debug(
      "Empty-group watcher installed on",
      `${dom.describe(root)}.`,
    );
  },
};
