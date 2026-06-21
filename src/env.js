import { Log } from "./logger.js";

const env = (() => {
  let browserWindow = typeof window === "undefined" ? null : window;
  if (!browserWindow?.gBrowser) {
    try {
      const mostRecent = Services.wm.getMostRecentWindow("navigator:browser");
      if (mostRecent?.gBrowser) {
        browserWindow = mostRecent;
      }
    } catch (e) {
      Log.init.error(
        "Could not resolve a browser window via Services.wm; gBrowser is unavailable.",
        e,
      );
    }
  }
  return browserWindow?.gBrowser
    ? {
        win: browserWindow,
        doc: browserWindow.document,
        gBrowser: browserWindow.gBrowser,
      }
    : null;
})();

if (!env) {
  const reason =
    "No window with gBrowser found. Use the Browser Console " +
    "(Ctrl+Shift+J) with devtools.chrome.enabled = true.";
  Log.init.error(`Startup aborted: ${reason}`);
  throw new Error(reason);
}

export const { win, doc, gBrowser } = env;

export const LOAD_TOKEN = {};
