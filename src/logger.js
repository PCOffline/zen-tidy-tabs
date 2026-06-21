import { CONFIG } from "./config.js";

const PREFIX = "[Zen Tidy Tabs]";

const makeLogger = (stage) => {
  const tag = `${PREFIX} [${stage}]`;
  return {
    info: (...args) => console.info(tag, ...args),
    warn: (...args) => console.warn(tag, ...args),
    error: (...args) => console.error(tag, ...args),
    debug: (...args) => {
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
