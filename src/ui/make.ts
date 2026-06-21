import { doc } from "../env";

export const make = {
  el(tag: string, className?: string, text?: string): HTMLElement {
    const node = doc.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text != null) {
      node.textContent = text;
    }
    return node;
  },
  field(labelText: string, control: HTMLElement): HTMLElement {
    const field = make.el("div", "zen-tidy-tabs-field");
    field.append(make.el("label", "zen-tidy-tabs-label", labelText), control);
    return field;
  },
  input(
    value: string | undefined,
    { type = "text", placeholder = "" } = {},
  ): HTMLInputElement {
    const input = make.el("input", "zen-tidy-tabs-input") as HTMLInputElement;
    input.type = type;
    input.value = value ?? "";
    if (placeholder) {
      input.placeholder = placeholder;
    }
    return input;
  },
  button(text: string, variant = ""): HTMLElement {
    return make.el(
      "button",
      `zen-tidy-tabs-btn${variant ? ` ${variant}` : ""}`,
      text,
    );
  },
};
