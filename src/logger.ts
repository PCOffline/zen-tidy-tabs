import { CONFIG } from "./config";

interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

const PREFIX = "[Zen Tidy Tabs]";

const makeLogger = (stage: string): Logger => {
  const tag = `${PREFIX} [${stage}]`;
  return {
    info: (...args: unknown[]) => console.info(tag, ...args),
    warn: (...args: unknown[]) => console.warn(tag, ...args),
    error: (...args: unknown[]) => console.error(tag, ...args),
    debug: (...args: unknown[]) => {
      if (CONFIG.debug) {
        console.debug(tag, ...args);
      }
    },
  };
};

export const Log = {
  init: makeLogger("Initialization"),
  config: makeLogger("Config"),
  dom: makeLogger("DOM"),
  styles: makeLogger("Styles"),
  ai: makeLogger("AI"),
  groups: makeLogger("Groups"),
  tidy: makeLogger("Tidy"),
  user: makeLogger("User Interaction"),
  diagnose: makeLogger("Diagnostics"),
};
