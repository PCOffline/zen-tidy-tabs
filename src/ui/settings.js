import { CONFIG } from "../config.js";
import { doc, gBrowser, win } from "../env.js";
import { Log } from "../logger.js";
import { orchestrator } from "../orchestrator.js";
import { prefs } from "../prefs.js";
import { make } from "./make.js";
import { modal } from "./modal.js";
import { styles } from "./styles.js";

export const ui = {
  segmentedControl(options, current, onChange) {
    let value = current;
    const segment = make.el("div", "zen-tidy-tabs-segment");
    options.forEach(([optionValue, text]) => {
      const button = make.el("button", "zen-tidy-tabs-seg", text);
      if (optionValue === current) {
        button.classList.add("active");
      }
      button.addEventListener("click", () => {
        value = optionValue;
        segment.querySelectorAll(".zen-tidy-tabs-seg").forEach((s) => {
          s.classList.remove("active");
        });
        button.classList.add("active");
        onChange?.(optionValue);
      });
      segment.append(button);
    });
    return { el: segment, get: () => value };
  },

  settings() {
    const { body, footer } = modal.open("Zen Tidy Tabs Settings");
    Log.user.debug("Opened the settings modal.");

    const key = make.input(prefs.apiKey(), {
      type: "password",
      placeholder: "sk-or-v1-...",
    });
    const model = make.input(prefs.model(), {
      placeholder: CONFIG.api.defaultModel,
    });

    const labelSegment = ui.segmentedControl(
      [
        ["filled", "Colored"],
        ["text", "Text only"],
      ],
      prefs.labelStyle(),
    );
    const urlNotes = {
      detailed: "The tab's title and full URL are sent to the AI.",
      compact: "The tab's title and hostname are sent to the AI.",
      minimal: "Only the tab's title is sent to the AI.",
    };
    const urlHint = make.el(
      "p",
      "zen-tidy-tabs-privacy-note",
      urlNotes[prefs.urlMode()] ?? urlNotes.detailed,
    );
    const urlSegment = ui.segmentedControl(
      [
        ["detailed", "Detailed"],
        ["compact", "Compact"],
        ["minimal", "Minimal"],
      ],
      prefs.urlMode(),
      (mode) => {
        urlHint.textContent = urlNotes[mode] ?? urlNotes.detailed;
      },
    );

    const keyHint = make.el("p", "zen-tidy-tabs-hint");
    keyHint.append(doc.createTextNode("Key is stored locally. Get one at "));
    const keysUrl = "https://openrouter.ai/keys";
    const link = make.el("a", "zen-tidy-tabs-link", "openrouter.ai/keys");
    link.href = keysUrl;
    const openKeysPage = (e) => {
      e?.preventDefault();
      modal.close();
      if (typeof win.openTrustedLinkIn === "function") {
        win.openTrustedLinkIn(keysUrl, "tab");
      } else if (typeof gBrowser.addTrustedTab === "function") {
        gBrowser.selectedTab = gBrowser.addTrustedTab(keysUrl);
      } else {
        Log.user.error(
          `Could not open ${keysUrl}: no trusted-link API is available in this build.`,
        );
      }
    };
    link.addEventListener("click", openKeysPage);
    link.addEventListener("keydown", (e) => {
      if (e.key === " ") {
        openKeysPage(e);
      }
    });
    keyHint.append(link, doc.createTextNode("."));

    body.append(
      make.field("OpenRouter API key", key),
      make.field("Model", model),
      make.field("Group labels", labelSegment.el),
      make.field("Tab info sent to AI", urlSegment.el),
      urlHint,
      keyHint,
    );

    const cancel = make.button("Cancel", "ghost");
    cancel.addEventListener("click", modal.close);

    const save = make.button("Save settings", "primary");
    save.addEventListener("click", () => {
      prefs.set(CONFIG.prefs.apiKey, key.value.trim());
      prefs.set(CONFIG.prefs.model, model.value.trim());
      prefs.set(CONFIG.prefs.labelStyle, labelSegment.get());
      prefs.set(CONFIG.prefs.urlMode, urlSegment.get());
      Log.user.info(
        `Settings saved (model: ${model.value.trim() || CONFIG.api.defaultModel}, labelStyle: ${labelSegment.get()}, urlMode: ${urlSegment.get()}, apiKey: ${key.value.trim() ? "set" : "empty"}).`,
      );
      styles.inject();
      modal.close();
      orchestrator.notify("Settings saved.");
    });

    footer.append(make.el("div", "zen-tidy-tabs-spacer"), cancel, save);
    key.focus();
  },
};
