import { CONFIG } from "../config.js";
import { doc } from "../env.js";
import { Log } from "../logger.js";
import { prefs } from "../prefs.js";

export const styles = {
  theme: {
    bg: "var(--zen-main-browser-background, #1f1e25)",
    elevated: "var(--zen-colors-tertiary, #2a2833)",
    border: "var(--zen-colors-border, #3a3845)",
    text: "var(--zen-primary-color, #ECECEC)",
    muted: "#9b99a6",
    accent: "var(--zen-primary-color, #6c5ce7)",
  },

  labelStyleCss() {
    if (prefs.labelStyle() !== "text") {
      return "";
    }
    return `
      .tab-group-label {
        background: transparent !important;
        color: var(--toolbox-textcolor, var(--toolbar-color, currentColor)) !important;
        opacity: .9;
        font-weight: 700 !important;
        letter-spacing: .01em;
        text-shadow: none !important;
      }
      .tab-group-label:hover { opacity: 1; }
    `;
  },

  inject() {
    const theme = styles.theme;
    doc.getElementById(CONFIG.ui.styleId)?.remove();
    const style = doc.createElement("style");
    style.id = CONFIG.ui.styleId;
    style.textContent = `
      #${CONFIG.ui.controlId} {
        cursor: pointer;
        color: inherit !important;
        font: inherit !important;
        background: none !important;
        border: none !important;
        box-shadow: none !important;
      }
      #${CONFIG.ui.controlId}::before { content: none !important; }
      #${CONFIG.ui.controlId}.zen-tidy-tabs-fallback {
        display: block !important;
        visibility: visible !important;
        box-sizing: border-box;
        width: calc(100% - 12px);
        margin: 2px 6px;
        padding: 2px 6px;
        text-align: right;
        font-size: 12px;
        color: ${theme.accent} !important;
        opacity: 0;
        transition: opacity .12s ease;
      }
      .zen-workspace-tabs-section:hover #${CONFIG.ui.controlId}.zen-tidy-tabs-fallback { opacity: .85; }
      #${CONFIG.ui.controlId}.zen-tidy-tabs-fallback:hover { opacity: 1; }

      .zen-tidy-tabs-overlay {
        position: fixed; inset: 0; z-index: 2147483647;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,.45);
        -moz-window-dragging: no-drag;
        opacity: 0; transition: opacity .14s ease;
      }
      .zen-tidy-tabs-overlay.open { opacity: 1; }
      .zen-tidy-tabs-modal {
        width: 340px; max-width: calc(100vw - 32px);
        background: ${theme.bg};
        color: ${theme.text};
        border: 1px solid ${theme.border};
        border-radius: 14px;
        box-shadow: 0 18px 48px rgba(0,0,0,.5);
        font: menu;
        overflow: hidden;
        transform: translateY(6px) scale(.985);
        transition: transform .14s ease;
      }
      .zen-tidy-tabs-overlay.open .zen-tidy-tabs-modal { transform: none; }
      .zen-tidy-tabs-modal-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 16px 10px;
      }
      .zen-tidy-tabs-modal-title { font-size: 14px; font-weight: 600; }
      .zen-tidy-tabs-modal-close {
        all: unset; cursor: pointer; color: ${theme.muted};
        width: 22px; height: 22px; border-radius: 6px; text-align: center;
      }
      .zen-tidy-tabs-modal-close:hover { background: ${theme.elevated}; color: ${theme.text}; }
      .zen-tidy-tabs-modal-body { padding: 4px 16px 8px; display: flex; flex-direction: column; gap: 14px; }
      .zen-tidy-tabs-modal-footer {
        display: flex; align-items: center; gap: 8px;
        padding: 12px 16px 16px;
      }
      .zen-tidy-tabs-spacer { flex: 1; }

      .zen-tidy-tabs-field { display: flex; flex-direction: column; gap: 6px; }
      .zen-tidy-tabs-label { font-size: 11px; color: ${theme.muted}; font-weight: 600; }
      .zen-tidy-tabs-input {
        all: unset; box-sizing: border-box; width: 100%;
        padding: 8px 10px; font-size: 13px;
        color: ${theme.text};
        background: ${theme.elevated};
        border: 1px solid ${theme.border}; border-radius: 9px;
      }
      .zen-tidy-tabs-input:focus {
        border-color: ${theme.accent};
      }

      .zen-tidy-tabs-segment {
        display: inline-flex; flex-wrap: wrap; padding: 3px; gap: 3px;
        background: ${theme.elevated}; border: 1px solid ${theme.border};
        border-radius: 10px;
      }
      .zen-tidy-tabs-seg {
        all: unset; cursor: pointer; padding: 5px 12px; font-size: 12px;
        color: ${theme.muted}; border-radius: 7px; text-align: center;
      }
      .zen-tidy-tabs-seg.active { background: ${theme.accent}; color: #fff; }

      .zen-tidy-tabs-hint { margin: 2px 0 0; font-size: 11px; color: ${theme.muted}; }
      .zen-tidy-tabs-privacy-note { margin: 2px 0 0; font-size: 13px; line-height: 1.45; color: ${theme.text}; }
      .zen-tidy-tabs-link { color: ${theme.accent}; cursor: pointer; text-decoration: underline; }

      .zen-tidy-tabs-btn {
        all: unset; cursor: pointer; padding: 7px 14px; font-size: 13px; font-weight: 600;
        border-radius: 9px; color: ${theme.text}; background: ${theme.elevated};
        border: 1px solid ${theme.border}; text-align: center;
      }
      .zen-tidy-tabs-btn:hover { filter: brightness(1.12); }
      .zen-tidy-tabs-btn.primary { background: ${theme.accent}; border-color: transparent; color: #fff; }
      .zen-tidy-tabs-btn.ghost { background: transparent; }

      .zen-tidy-tabs-inline-input {
        all: unset;
        box-sizing: border-box;
        min-width: 0; max-width: 100%;
        font: inherit;
        cursor: text;
        caret-color: ${theme.accent};
      }

      /* BADGE-7: while renaming, stop Zen's empty sidebar from swallowing the mouse press */
      :root.zen-tidy-tabs-editing .zen-workspace-empty-space {
        -moz-window-dragging: no-drag;
      }

      ${styles.labelStyleCss()}
    `;
    (doc.head || doc.documentElement).appendChild(style);
    Log.styles.debug(
      `Stylesheet injected (#${CONFIG.ui.styleId}, labelStyle: ${prefs.labelStyle()}).`,
    );
  },
};
