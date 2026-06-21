import { ai } from "./ai.js";
import { CONFIG } from "./config.js";
import { gBrowser } from "./env.js";
import { groups } from "./groups.js";
import { Log } from "./logger.js";
import { prefs } from "./prefs.js";
import { tabs } from "./tabs.js";
import { control } from "./ui/control.js";

export const orchestrator = {
  running: false,

  notify(message, isError = false) {
    (isError ? Log.tidy.error : Log.tidy.info)(message);
    try {
      const box = gBrowser.getNotificationBox();
      const appended = box.appendNotification(
        CONFIG.ui.notificationValue,
        {
          label: `Zen Tidy Tabs: ${message}`,
          priority: isError ? box.PRIORITY_WARNING_HIGH : box.PRIORITY_INFO_LOW,
        },
        [],
      );
      Promise.resolve(appended).then((note) => {
        if (!note) {
          return;
        }
        setTimeout(() => {
          try {
            box.removeNotification(note);
          } catch {
            /* notification already removed */
          }
        }, CONFIG.timing.notifyDurationMs);
      });
    } catch {
      /* notification box unavailable */
    }
  },

  async runTidy() {
    if (orchestrator.running) {
      Log.tidy.debug(
        "Ignoring Tidy request: a tidy run is already in progress.",
      );
      return;
    }

    const apiKey = prefs.apiKey();
    if (!apiKey) {
      Log.tidy.warn("Tidy aborted: no OpenRouter API key configured.");
      orchestrator.notify(
        `Set your key in about:config → ${CONFIG.prefs.apiKey}`,
        true,
      );
      return;
    }

    const sourceTabs = tabs.collect(true);
    if (sourceTabs.length < CONFIG.grouping.minTabs) {
      Log.tidy.warn(
        `Tidy aborted: only ${sourceTabs.length} eligible tab(s), need at least ${CONFIG.grouping.minTabs}.`,
      );
      orchestrator.notify(
        `Need at least ${CONFIG.grouping.minTabs} tabs to tidy.`,
        true,
      );
      return;
    }

    orchestrator.running = true;
    control.setBusy(true);
    try {
      Log.tidy.info(
        `Starting tidy of ${sourceTabs.length} tab(s) (model: ${prefs.model()}, urlMode: ${prefs.urlMode()}).`,
      );
      const response = await ai.request(
        tabs.snapshot(sourceTabs),
        apiKey,
        prefs.model(),
      );
      const plan = ai.parseGroups(ai.extractText(response), sourceTabs);
      Log.tidy.info(
        "Grouping plan:",
        plan.map((g) => `${g.name}(${g.tabs.length})`).join(", "),
      );

      const { realized, failed } = groups.apply(plan);
      groups.scheduleEmptyCheck();
      if (failed === 0) {
        Log.tidy.info(
          `Tidy complete: sorted ${sourceTabs.length} tab(s) into ${realized} group(s).`,
        );
        orchestrator.notify(
          `Sorted ${sourceTabs.length} tabs into ${realized} groups.`,
        );
      } else if (realized > 0) {
        Log.tidy.warn(
          `Tidy partially complete: created ${realized} group(s), ${failed} could not be created.`,
        );
        orchestrator.notify(
          `Sorted ${sourceTabs.length} tabs into ${realized} groups; ${failed} could not be created.`,
          true,
        );
      } else {
        Log.tidy.error(
          `Tidy failed: none of the ${plan.length} group(s) could be created.`,
        );
        orchestrator.notify("Tidy failed: no groups could be created.", true);
      }
    } catch (e) {
      Log.tidy.error("Tidy run failed.", e);
      orchestrator.notify(`Tidy failed: ${e.message || e}`, true);
    } finally {
      orchestrator.running = false;
      control.setBusy(false);
    }
  },
};
