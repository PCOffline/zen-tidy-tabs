import { CONFIG } from "./config";
import { diag } from "./diagnostics";
import { doc, gBrowser, win } from "./env";
import { groups } from "./groups";
import { Log } from "./logger";
import { orchestrator } from "./orchestrator";
import { tabs } from "./tabs";
import { control } from "./ui/control";
import { editor } from "./ui/editor";
import { ui } from "./ui/settings";
import { styles } from "./ui/styles";

const init = (): void => {
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

  if (win.__zenTidyTabsMountRetryTimer) {
    clearInterval(win.__zenTidyTabsMountRetryTimer);
    win.__zenTidyTabsMountRetryTimer = null;
  }

  if (!control.mount()) {
    let attempts = 0;
    win.__zenTidyTabsMountRetryTimer = setInterval(() => {
      if (control.mount() || ++attempts > CONFIG.timing.mountMaxAttempts) {
        clearInterval(
          win.__zenTidyTabsMountRetryTimer as ReturnType<typeof setInterval>,
        );
        win.__zenTidyTabsMountRetryTimer = null;
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
