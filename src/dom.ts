import { doc, gBrowser, win } from "./env";

export const TAB_SELECTOR = "tab, .tabbrowser-tab";

export const normalizeName = (name: string | null | undefined): string =>
  String(name ?? "")
    .trim()
    .toLowerCase();

export const getGroupName = (
  el: ZenTabGroup | Element | null | undefined,
): string =>
  (el?.getAttribute?.("label") || (el as ZenTabGroup)?.label || "").trim();

export const getGroupColor = (
  el: ZenTabGroup | Element | null | undefined,
): string => (el as ZenTabGroup)?.color ?? el?.getAttribute?.("color") ?? "";

export const getGroupTabs = (el: ZenTabGroup): ZenTab[] | NodeListOf<Element> =>
  el.tabs || el.querySelectorAll(TAB_SELECTOR);

export const setGroupName = (el: ZenTabGroup, name: string): void => {
  el.label = name;
  el.setAttribute("label", name);
};

export const setGroupColor = (el: ZenTabGroup, color: string): void => {
  el.color = color;
  el.setAttribute("color", color);
};

export const CLEAR_SELECTOR =
  "toolbarbutton, button, label, span, hbox, vbox, toolbaritem, div, image, [label], [tooltiptext]";

export const matchesClear = (el: Element): boolean => {
  if ((el.getAttribute?.("label") ?? "").trim().toLowerCase() === "clear") {
    return true;
  }
  if ((el.textContent ?? "").trim().toLowerCase() === "clear") {
    return true;
  }
  if (el.children.length === 0) {
    const hasClearPseudo = ["::before", "::after"].some((pseudo) => {
      try {
        return /clear/i.test(getComputedStyle(el, pseudo).content ?? "");
      } catch {
        return false;
      }
    });
    if (hasClearPseudo) {
      return true;
    }
  }
  return false;
};

export const dom = {
  activeWorkspaceEl(): Element | null {
    return (
      win.gZenWorkspaces?.activeWorkspaceElement ||
      doc.querySelector("zen-workspace[active]") ||
      gBrowser.selectedTab?.closest?.(".zen-workspace-tabs-section") ||
      doc.querySelector("zen-workspace")
    );
  },

  activeSection(): Element | null {
    return (
      gBrowser.selectedTab?.closest?.(".zen-workspace-tabs-section") ||
      doc.querySelector(".zen-workspace-tabs-section[active]") ||
      doc.querySelector(".zen-workspace-tabs-section")
    );
  },

  clearControl(): Element | null {
    const scopes = [dom.activeWorkspaceEl(), dom.activeSection(), doc].filter(
      (x): x is Element | Document => Boolean(x),
    );
    const seen = new Set<Element>();

    for (const scope of scopes) {
      for (const el of scope.querySelectorAll(CLEAR_SELECTOR)) {
        if (seen.has(el)) {
          continue;
        }
        seen.add(el);
        if (matchesClear(el)) {
          return el;
        }
      }
    }
    return null;
  },

  firstNormalNode(section: Element): Element | null {
    return (
      Array.from(
        section.querySelectorAll("tab-group, tab, .tabbrowser-tab"),
      ).find(
        (el) =>
          dom.isGroupEl(el) ||
          !((el as ZenTab).pinned || el.hasAttribute?.("zen-essential")),
      ) ?? null
    );
  },

  isGroupEl(el: Element | null | undefined): boolean {
    return (
      (el?.tagName ?? "").toLowerCase() === "tab-group" ||
      el?.classList?.contains?.("tab-group") ||
      false
    );
  },

  describe(el: Element | null | undefined): string {
    if (!el) {
      return "null";
    }
    return (
      (el.tagName ?? "?").toLowerCase() +
      (el.id ? `#${el.id}` : "") +
      (el.className ? `.${String(el.className).trim().split(/\s+/)[0]}` : "")
    );
  },
};
