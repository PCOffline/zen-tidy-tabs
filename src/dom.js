import { doc, gBrowser, win } from "./env.js";

export const TAB_SELECTOR = "tab, .tabbrowser-tab";

export const normalizeName = (name) =>
  String(name ?? "")
    .trim()
    .toLowerCase();

export const getGroupName = (el) =>
  (el?.label || el?.getAttribute?.("label") || "").trim();

export const getGroupColor = (el) =>
  el?.color ?? el?.getAttribute?.("color") ?? "";

export const getGroupTabs = (el) =>
  el.tabs || el.querySelectorAll(TAB_SELECTOR);

export const setGroupName = (el, name) => {
  el.label = name;
  el.setAttribute("label", name);
};

export const setGroupColor = (el, color) => {
  el.color = color;
  el.setAttribute("color", color);
};

export const CLEAR_SELECTOR =
  "toolbarbutton, button, label, span, hbox, vbox, toolbaritem, div, image, [label], [tooltiptext]";

export const matchesClear = (el) => {
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
  activeWorkspaceEl() {
    return (
      win.gZenWorkspaces?.activeWorkspaceElement ||
      doc.querySelector("zen-workspace[active]") ||
      gBrowser.selectedTab?.closest?.("zen-workspace") ||
      doc.querySelector("zen-workspace")
    );
  },

  activeSection() {
    return (
      gBrowser.selectedTab?.closest?.(".zen-workspace-tabs-section") ||
      doc.querySelector(".zen-workspace-tabs-section[active]") ||
      doc.querySelector(".zen-workspace-tabs-section")
    );
  },

  clearControl() {
    const scopes = [dom.activeWorkspaceEl(), dom.activeSection(), doc].filter(
      Boolean,
    );
    const seen = new Set();

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

  firstNormalNode(section) {
    return (
      Array.from(
        section.querySelectorAll("tab-group, tab, .tabbrowser-tab"),
      ).find(
        (el) =>
          dom.isGroupEl(el) ||
          !(el.pinned || el.hasAttribute?.("zen-essential")),
      ) ?? null
    );
  },

  isGroupEl(el) {
    return (
      (el?.tagName ?? "").toLowerCase() === "tab-group" ||
      el?.classList?.contains?.("tab-group")
    );
  },

  describe(el) {
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
