import { getGroupName, setGroupName } from "../dom";
import { doc, gBrowser, win } from "../env";
import { Log } from "../logger";
import { nativePanel } from "./native-panel";

const HTML_NS = "http://www.w3.org/1999/xhtml";

interface InlineEditState {
  input: HTMLInputElement;
  labelEl: HTMLElement;
  group: ZenTabGroup;
  original: string;
  discard: () => void;
  cleanup: () => void;
}

export const editor = {
  active: null as InlineEditState | null,

  install(): void {
    const prev = win.__zenTidyTabsEditorListeners;
    if (prev) {
      doc.removeEventListener("click", prev.onClick, true);
      doc.removeEventListener("contextmenu", prev.onContextMenu, true);
    }
    editor.cancelInline();
    doc.querySelectorAll(".zen-tidy-tabs-inline-input").forEach((input) => {
      const measure = input.previousElementSibling;
      if (measure?.tagName?.toLowerCase() === "span") {
        measure.remove();
      }
      input.remove();
    });
    doc.querySelectorAll(".zen-tidy-tabs-inline-editing").forEach((label) => {
      (label as HTMLElement).style.removeProperty("display");
      label.classList.remove("zen-tidy-tabs-inline-editing");
    });
    doc.documentElement.classList.remove("zen-tidy-tabs-editing");
    nativePanel.uninstall();

    const onClick = (e: MouseEvent) => {
      if (e.button !== 0) {
        return;
      }
      if ((e.target as Element)?.closest?.(".zen-tidy-tabs-inline-input")) {
        e.stopPropagation();
        return;
      }
      const labelEl = (e.target as Element)?.closest?.(
        ".tab-group-label",
      ) as HTMLElement | null;
      if (!labelEl) {
        return;
      }
      const group = labelEl.closest("tab-group") as ZenTabGroup | null;
      if (!group) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      editor.startInline(group, labelEl);
    };

    const onContextMenu = (e: MouseEvent) => {
      const hit = (e.target as Element)?.closest?.(
        ".tab-group-label, .zen-tidy-tabs-inline-input",
      );
      if (!hit) {
        return;
      }
      const group = hit.closest("tab-group") as ZenTabGroup | null;
      if (!group) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      editor.cancelInline();
      setTimeout(() => {
        try {
          gBrowser.tabGroupMenu?.openEditModal(group);
          nativePanel.customize();
        } catch (err) {
          Log.user.error("Failed to open Zen's native group edit panel.", err);
        }
      }, 0);
    };

    doc.addEventListener("click", onClick, true);
    doc.addEventListener("contextmenu", onContextMenu, true);
    win.__zenTidyTabsEditorListeners = { onClick, onContextMenu };

    Log.user.debug("Group label editor installed.");
  },

  startInline(group: ZenTabGroup, labelEl: HTMLElement): void {
    if (editor.active?.labelEl === labelEl) {
      editor.active.input.focus();
      return;
    }
    editor.cancelInline();

    const original = getGroupName(group);

    const input = doc.createElementNS(HTML_NS, "input") as HTMLInputElement;
    input.className = "zen-tidy-tabs-inline-input";
    input.value = original;
    input.setAttribute("aria-label", "Rename group");

    const cs = getComputedStyle(labelEl);
    const INHERITED_STYLE_PROPS = [
      "fontFamily",
      "fontSize",
      "fontWeight",
      "fontStyle",
      "letterSpacing",
      "lineHeight",
      "color",
      "backgroundColor",
      "backgroundImage",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "borderRadius",
      "height",
      "textAlign",
      "textShadow",
    ];
    INHERITED_STYLE_PROPS.forEach((prop) => {
      (input.style as unknown as Record<string, string>)[prop] =
        (cs as unknown as Record<string, string>)[prop] ?? "";
    });

    const measure = doc.createElementNS(HTML_NS, "span") as HTMLElement;
    measure.style.position = "absolute";
    measure.style.visibility = "hidden";
    measure.style.whiteSpace = "pre";
    measure.style.pointerEvents = "none";
    const MEASURE_FONT_PROPS = [
      "fontFamily",
      "fontSize",
      "fontWeight",
      "fontStyle",
      "letterSpacing",
    ];
    MEASURE_FONT_PROPS.forEach((prop) => {
      (measure.style as unknown as Record<string, string>)[prop] =
        (cs as unknown as Record<string, string>)[prop] ?? "";
    });
    const MEASURE_PADDING_PX = 2;
    const MIN_INPUT_WIDTH_PX = 8;
    const sizeToText = () => {
      measure.textContent = input.value ?? "";
      const measuredWidth =
        Math.ceil(measure.getBoundingClientRect().width) + MEASURE_PADDING_PX;
      input.style.width = `${Math.max(measuredWidth, MIN_INPUT_WIDTH_PX)}px`;
    };
    input.style.boxSizing = "content-box";
    input.style.flex = "0 0 auto";

    labelEl.classList.add("zen-tidy-tabs-inline-editing");
    doc.documentElement.classList.add("zen-tidy-tabs-editing");
    labelEl.style.display = "none";
    labelEl.parentNode?.insertBefore(input, labelEl);
    input.parentNode?.insertBefore(measure, input);
    sizeToText();

    let settled = false;
    const finish = (commit: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      const name = input.value.trim();
      editor.finishInline();
      if (commit && name && name !== original) {
        try {
          setGroupName(group, name);
          Log.user.info(`Renamed group "${original}" to "${name}".`);
        } catch (e) {
          Log.user.error(
            `Failed to rename group "${original}" to "${name}".`,
            e,
          );
        }
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
      e.stopPropagation();
    };
    const onBlur = () => finish(true);
    const onDocDown = (e: MouseEvent) => {
      if (e.target === input || input.contains(e.target as Node)) {
        return;
      }
      finish(true);
    };

    input.addEventListener("input", sizeToText);
    input.addEventListener("keydown", onKey, true);
    input.addEventListener("blur", onBlur);
    doc.addEventListener("mousedown", onDocDown, true);

    editor.active = {
      input,
      labelEl,
      group,
      original,
      discard: () => finish(false),
      cleanup: () => {
        measure.remove();
        input.removeEventListener("input", sizeToText);
        input.removeEventListener("keydown", onKey, true);
        input.removeEventListener("blur", onBlur);
        doc.removeEventListener("mousedown", onDocDown, true);
      },
    };

    input.focus();
    input.select();
  },

  finishInline(): void {
    const state = editor.active;
    if (!state) {
      return;
    }
    editor.active = null;
    state.cleanup?.();
    state.input.remove();
    doc.documentElement.classList.remove("zen-tidy-tabs-editing");
    state.labelEl.style.removeProperty("display");
    state.labelEl.classList.remove("zen-tidy-tabs-inline-editing");
  },

  cancelInline(): void {
    editor.active?.discard?.();
  },
};
