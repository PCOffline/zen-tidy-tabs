import { CONFIG } from "./config";
import { Log } from "./logger";

export type UrlMode = "detailed" | "compact" | "minimal";

export const prefs = {
  get(name: string, fallback: string = ""): string {
    try {
      return Services.prefs.getStringPref(name, fallback);
    } catch {
      return fallback;
    }
  },
  set(name: string, value: string | undefined): void {
    try {
      Services.prefs.setStringPref(name, value ?? "");
      Log.config.debug(`Saved preference "${name}".`);
    } catch (e) {
      Log.config.error(`Failed to save preference "${name}".`, e);
    }
  },
  apiKey(): string {
    return prefs.get(CONFIG.prefs.apiKey);
  },
  model(): string {
    return prefs.get(CONFIG.prefs.model, CONFIG.api.defaultModel);
  },
  labelStyle(): string {
    return prefs.get(CONFIG.prefs.labelStyle, "filled");
  },
  urlMode(): UrlMode {
    const mode = prefs.get(CONFIG.prefs.urlMode, "detailed");
    return ["detailed", "compact", "minimal"].includes(mode)
      ? (mode as UrlMode)
      : "detailed";
  },
};
