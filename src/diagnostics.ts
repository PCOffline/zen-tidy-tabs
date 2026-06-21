import { CLEAR_SELECTOR, dom, matchesClear } from "./dom";
import { doc, gBrowser } from "./env";
import { Log } from "./logger";

export const diag = {
  pseudo(el: Element, which: string): string {
    try {
      return getComputedStyle(el, which).content ?? "";
    } catch {
      return "";
    }
  },

  path(el: Element | null, depth = 8): string {
    const parts: string[] = [];
    let current: Element | null = el;
    for (let i = 0; current && i < depth; i++) {
      parts.unshift(dom.describe(current));
      current = current.parentElement;
    }
    return parts.join(" > ");
  },

  clearCandidates(): {
    el: Element;
    text: string;
    label: string;
    tip: string;
    pseudo: string;
  }[] {
    return [...doc.querySelectorAll(CLEAR_SELECTOR)]
      .filter(matchesClear)
      .map((el) => ({
        el,
        text: (el.textContent ?? "").trim(),
        label: el.getAttribute?.("label") ?? "",
        tip: el.getAttribute?.("tooltiptext") ?? "",
        pseudo:
          el.children.length > 0
            ? ""
            : diag.pseudo(el, "::before") + diag.pseudo(el, "::after"),
      }));
  },

  newTabButton(): Element | null {
    return (
      (doc.getElementById("tabs-newtab-button") ||
        doc.querySelector(
          "[command='cmd_newNavigatorTab'], .tabs-newtab-button, #vertical-tabs-newtab-button",
        ) ||
        [...doc.querySelectorAll("toolbarbutton, button")].find((b) =>
          /new tab/i.test(
            `${b.getAttribute("label") ?? ""} ${b.textContent ?? ""}`,
          ),
        )) ??
      null
    );
  },

  run(): void {
    const MAX_CANDIDATES = 12;
    const TEXT_PREVIEW_LENGTH = 24;
    const PSEUDO_PREVIEW_LENGTH = 40;

    Log.diagnose.info("DOM diagnosis start");

    const selectedTab = gBrowser.selectedTab;
    Log.diagnose.info("selectedTab:", dom.describe(selectedTab));
    Log.diagnose.info("  ancestry:", diag.path(selectedTab));

    const section = dom.activeSection();
    Log.diagnose.info("activeSection:", dom.describe(section));
    if (section) {
      Log.diagnose.info(
        "  children:",
        [...section.children].map((c) => dom.describe(c)).join("  |  "),
      );
    }
    Log.diagnose.info(
      "firstNormalNode:",
      section ? dom.describe(dom.firstNormalNode(section)) : "n/a",
    );

    Log.diagnose.info(
      "clearControl() result:",
      dom.describe(dom.clearControl()),
    );

    const hits = diag.clearCandidates();
    Log.diagnose.info("'clear' candidates found:", hits.length);
    hits.slice(0, MAX_CANDIDATES).forEach((hit, i) => {
      Log.diagnose.info(`  [${i}] ${dom.describe(hit.el)}`);
      Log.diagnose.info(
        `       text="${hit.text.slice(0, TEXT_PREVIEW_LENGTH)}" label="${hit.label}" tip="${hit.tip}" pseudo=${JSON.stringify(hit.pseudo).slice(0, PSEUDO_PREVIEW_LENGTH)}`,
      );
      Log.diagnose.info(`       path: ${diag.path(hit.el, 6)}`);
    });

    const newTab = diag.newTabButton();
    Log.diagnose.info("newTab button:", dom.describe(newTab));
    if (newTab?.parentElement) {
      Log.diagnose.info(
        "  newTab siblings:",
        [...newTab.parentElement.children]
          .map((c) => dom.describe(c))
          .join("  |  "),
      );
      Log.diagnose.info(
        "  newTab parent path:",
        diag.path(newTab.parentElement, 6),
      );
    }

    Log.diagnose.info("DOM diagnosis end");
  },
};
