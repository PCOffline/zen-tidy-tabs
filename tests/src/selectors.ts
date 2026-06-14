// Selectors / identifiers mirrored from ../../index.uc.js (CONFIG.ui + the markup
// created by `modal`, `ui`, `control`, and `editor`). Keep this in sync with the
// script if those names ever change.
export const selectors = {
  // control.build()
  buttonId: "zen-tidy-tabs-button",
  styleId: "zen-tidy-tabs-style",

  // modal.open()
  overlayId: "zen-tidy-tabs-overlay",
  modal: ".zen-tidy-tabs-modal",
  modalTitle: ".zen-tidy-tabs-modal-title",
  modalBody: ".zen-tidy-tabs-modal-body",
  modalFooter: ".zen-tidy-tabs-modal-footer",

  // mk.input / mk.button / ui.segmentedControl
  input: ".zen-tidy-tabs-input",
  btnPrimary: ".zen-tidy-tabs-btn.primary",
  segButton: ".zen-tidy-tabs-seg",

  // editor.startInline()
  inlineEditingClass: "zen-tidy-tabs-inline-editing",
  inlineInput: ".zen-tidy-tabs-inline-input",

  // native Zen tab groups
  groupLabel: ".tab-group-label",

  // Zen's native "Clear unpinned tabs" control (CONTROL-6: the Tidy twin must NOT
  // copy this class) and the per-workspace container element (CONTROL-7).
  clearControlClass: "zen-workspace-close-unpinned-tabs-button",
  workspaceEl: "zen-workspace",

  // prefs (CONFIG.prefs)
  prefs: {
    apiKey: "zen-tidy-tabs.apikey",
    model: "zen-tidy-tabs.model",
    labelStyle: "zen-tidy-tabs.labelstyle",
    urlMode: "zen-tidy-tabs.urlmode",
  },
} as const;

export type Selectors = typeof selectors;
