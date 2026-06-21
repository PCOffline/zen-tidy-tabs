import { doc } from "../env.js";

export const make = {
  el(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text != null) {
      node.textContent = text;
    }
    return node;
  },
  field(labelText, control) {
    const field = make.el("div", "zen-tidy-tabs-field");
    field.append(make.el("label", "zen-tidy-tabs-label", labelText), control);
    return field;
  },
  input(value, { type = "text", placeholder = "" } = {}) {
    const input = make.el("input", "zen-tidy-tabs-input");
    input.type = type;
    input.value = value ?? "";
    if (placeholder) {
      input.placeholder = placeholder;
    }
    return input;
  },
  button(text, variant = "") {
    return make.el(
      "button",
      `zen-tidy-tabs-btn${variant ? ` ${variant}` : ""}`,
      text,
    );
  },
};
