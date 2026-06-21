import { CONFIG } from "../config.js";
import { doc } from "../env.js";
import { make } from "./make.js";

export const modal = {
  keyHandler: null,

  open(title) {
    modal.close();

    const overlay = make.el("div", "zen-tidy-tabs-overlay");
    overlay.id = CONFIG.ui.overlayId;

    const panel = make.el("div", "zen-tidy-tabs-modal");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", title);

    const header = make.el("div", "zen-tidy-tabs-modal-header");
    header.append(make.el("div", "zen-tidy-tabs-modal-title", title));
    const closeBtn = make.el("button", "zen-tidy-tabs-modal-close", "✕");
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", modal.close);
    header.append(closeBtn);

    const body = make.el("div", "zen-tidy-tabs-modal-body");
    const footer = make.el("div", "zen-tidy-tabs-modal-footer");
    panel.append(header, body, footer);
    overlay.append(panel);

    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) {
        modal.close();
      }
    });
    modal.keyHandler = (e) => {
      if (e.key === "Escape") {
        modal.close();
      } else if (e.key === "Tab") {
        modal.trapFocus(e, panel);
      }
    };
    doc.addEventListener("keydown", modal.keyHandler, true);

    (doc.documentElement || doc.body).appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("open"));
    return { overlay, body, footer };
  },

  trapFocus(e, panel) {
    const focusable = [
      ...panel.querySelectorAll(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      ),
    ].filter((el) => !el.disabled && el.offsetParent !== null);
    if (focusable.length === 0) {
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = doc.activeElement;
    if (e.shiftKey && (active === first || !panel.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  },

  close() {
    if (modal.keyHandler) {
      doc.removeEventListener("keydown", modal.keyHandler, true);
      modal.keyHandler = null;
    }
    doc.getElementById(CONFIG.ui.overlayId)?.remove();
  },
};
