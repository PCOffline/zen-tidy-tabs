import { CONFIG } from "./config.js";
import { Log } from "./logger.js";

export const prefs = {
  get(name, fallback = "") {
    try {
      return Services.prefs.getStringPref(name, fallback);
    } catch {
      return fallback;
    }
  },
  set(name, value) {
    try {
      Services.prefs.setStringPref(name, value ?? "");
      Log.config.debug(`Saved preference "${name}".`);
    } catch (e) {
      Log.config.error(`Failed to save preference "${name}".`, e);
    }
  },
  apiKey() {
    return prefs.get(CONFIG.prefs.apiKey);
  },
  model() {
    return prefs.get(CONFIG.prefs.model, CONFIG.api.defaultModel);
  },
  labelStyle() {
    return prefs.get(CONFIG.prefs.labelStyle, "filled");
  },
  urlMode() {
    const mode = prefs.get(CONFIG.prefs.urlMode, "detailed");
    return ["detailed", "compact", "minimal"].includes(mode)
      ? mode
      : "detailed";
  },
};
