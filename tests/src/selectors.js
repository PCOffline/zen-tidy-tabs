// @ts-check
// Selectors / identifiers mirrored from ../../index.js (CONFIG.ui + the markup
// created by `modal`, `ui`, `control`, and `editor`). Keep this in sync with the
// script if those names ever change.
module.exports = {
  // control.build()
  buttonId: "zen-tidy-tabs-button",
  styleId: "zen-tidy-tabs-style",

  // modal.open()
  overlayId: "zen-tidy-tabs-overlay",
  modal: ".zen-tidy-tabs-modal",
  modalTitle: ".zen-tidy-tabs-modal-title",
  modalBody: ".zen-tidy-tabs-modal-body",
  modalFooter: ".zen-tidy-tabs-modal-footer",

  // mk.input / mk.button / ui.colorPicker
  input: ".zen-tidy-tabs-input",
  btnPrimary: ".zen-tidy-tabs-btn.primary",
  swatch: ".zen-tidy-tabs-swatch",

  // editor.startInline()
  inlineEditingClass: "zen-tidy-tabs-inline-editing",

  // native Zen tab groups
  groupLabel: ".tab-group-label",

  // prefs (CONFIG.prefs)
  prefs: {
    apiKey: "zen-tidy-tabs.apikey",
    model: "zen-tidy-tabs.model",
  },

  // window.zenTidyTabs (init())
  globalApi: "zenTidyTabs",
};
