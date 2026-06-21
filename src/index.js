import { CONFIG } from "./config.js";
import { diag } from "./diagnostics.js";
import { doc, gBrowser, win } from "./env.js";
import { groups } from "./groups.js";
import { Log } from "./logger.js";
import { orchestrator } from "./orchestrator.js";
import { tabs } from "./tabs.js";
import { control } from "./ui/control.js";
import { editor } from "./ui/editor.js";
import { ui } from "./ui/settings.js";
import { styles } from "./ui/styles.js";

const init = () => {
  Log.init.info("Loading Zen Tidy Tabs…");
  Log.init.debug(
    "location:",
    (() => {
      try {
        return location.href;
      } catch {
        return "?";
      }
    })(),
  );
  Log.init.debug(
    `Environment: gBrowser.addTabGroup is ${typeof gBrowser.addTabGroup}, ${gBrowser.tabs.length} tab(s) open.`,
  );

  styles.inject();
  editor.install();
  groups.installEmptyWatcher();
  if (CONFIG.debug) {
    diag.run();
  }

  if (!control.mount()) {
    let attempts = 0;
    const timer = setInterval(() => {
      if (control.mount() || ++attempts > CONFIG.timing.mountMaxAttempts) {
        clearInterval(timer);
        if (!doc.getElementById(CONFIG.ui.controlId)) {
          Log.dom.warn(
            `Tidy control not placed after ${attempts} attempt(s); it will appear when you hover the tab separator.`,
          );
        }
      }
    }, CONFIG.timing.mountRetryMs);
  }

  win.zenTidyTabs = {
    run: () => orchestrator.runTidy(),
    settings: () => ui.settings(),
    mount: () => control.mount(),
    diagnose: () => diag.run(),
    injectStyles: () => styles.inject(),
    collect: (grouped = true) => tabs.collect(grouped),
  };
  Log.init.info(
    "Ready — left-click the Tidy control to organize tabs; right-click it for settings.",
  );
};

init();
