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

  // mk.input / mk.button / ui.colorPicker / ui.segmentedControl
  input: ".zen-tidy-tabs-input",
  btnPrimary: ".zen-tidy-tabs-btn.primary",
  swatch: ".zen-tidy-tabs-swatch",
  segButton: ".zen-tidy-tabs-seg",

  // editor.startInline()
  inlineEditingClass: "zen-tidy-tabs-inline-editing",

  // native Zen tab groups
  groupLabel: ".tab-group-label",

  // prefs (CONFIG.prefs)
  prefs: {
    apiKey: "zen-tidy-tabs.apikey",
    model: "zen-tidy-tabs.model",
    labelStyle: "zen-tidy-tabs.labelstyle",
    urlMode: "zen-tidy-tabs.urlmode",
  },
} as const;

export type Selectors = typeof selectors;
