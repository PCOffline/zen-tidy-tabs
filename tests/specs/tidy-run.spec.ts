import { expect, test } from "../src/fixtures";

// Run-level guarantees of a tidy operation:
//   CONTROL-4 — busy state while a run is in progress.
//   TIDY-1    — abort + notify when no API key is configured.
//   TIDY-2    — re-entrancy: ignore activations while a run is in progress.
//   TIDY-10   — success / failure notifications.
const API_KEY = "zen-tidy-tabs.apikey";
const IDLE_LABEL = "🧹 Tidy";
const BUSY_LABEL = "↻ Tidying…";
const PLAN = { groups: [{ name: "Anything", tabs: [0, 1, 2] }] };

test.describe("Tidy run", () => {
  test.beforeEach(async ({ zen }) => {
    await zen.reset();
    await zen.clearNotifications();
  });

  // CONTROL-4: the control shows a busy, non-interactive state mid-run.
  test("the control shows a busy state while a run is in progress", async ({
    zen,
  }) => {
    await zen.openTabs(4, "Busy ");
    // A deferred stub keeps the run in flight until we release it.
    await zen.installFetchStub(PLAN, { defer: true });
    try {
      await zen.clickButton();

      // While the run is in flight the control reads "↻ Tidying…" and is
      // non-interactive.
      await zen.driver.wait(
        async () => (await zen.buttonBusyState()).label === BUSY_LABEL,
        15_000,
        "the control never entered its busy state",
        100,
      );
      expect(
        (await zen.buttonBusyState()).pointerEvents,
        "the busy control is non-interactive",
      ).toBe("none");

      // Releasing the response lets the run finish; both revert.
      await zen.releaseFetch();
      await zen.driver.wait(
        async () => (await zen.buttonBusyState()).label === IDLE_LABEL,
        15_000,
        "the control never reverted from its busy state",
        100,
      );
      expect(
        (await zen.buttonBusyState()).pointerEvents,
        "the idle control is interactive again",
      ).toBe("");
    } finally {
      await zen.releaseFetch();
      await zen.restoreFetch();
    }
  });

  // TIDY-2: while one run is in progress, further activations are ignored.
  test("ignores a second activation while a run is in progress", async ({
    zen,
  }) => {
    await zen.openTabs(4, "Reentrant ");
    await zen.installFetchStub(PLAN, { defer: true });
    try {
      await zen.clickButton();
      // The first run reaches (and blocks on) the model exactly once.
      await zen.driver.wait(
        async () => (await zen.fetchStubCallCount()) === 1,
        15_000,
        "the first run never reached the model",
        100,
      );

      // Re-activating mid-run must be ignored: no extra model calls.
      await zen.clickButton();
      await zen.clickButton();
      await zen.driver.sleep(800);
      expect(
        await zen.fetchStubCallCount(),
        "re-entrant activations are ignored",
      ).toBe(1);

      // Let the single run finish; still exactly one model call.
      await zen.releaseFetch();
      await zen.driver.wait(
        async () => (await zen.buttonBusyState()).label === IDLE_LABEL,
        15_000,
        "the run never completed",
        100,
      );
      expect(
        await zen.fetchStubCallCount(),
        "only one run ever contacted the model",
      ).toBe(1);
    } finally {
      await zen.releaseFetch();
      await zen.restoreFetch();
    }
  });

  // TIDY-1: with no key, the run aborts before any network call and notifies.
  test("refuses to run without an API key and notifies", async ({ zen }) => {
    await zen.openTabs(4, "NoKey ");
    const savedKey = await zen.readPref(API_KEY);
    await zen.installFetchStub(PLAN);
    try {
      await zen.setPref(API_KEY, "");
      await zen.clickButton();
      // Give a run a beat to (not) start: it must bail before fetch.
      await zen.driver.sleep(1200);

      expect(
        await zen.fetchStubCallCount(),
        "no model call without a key",
      ).toBe(0);
      expect(await zen.groupLabels(), "no groups are created").toEqual([]);

      const note = await zen.lastNotification();
      expect(note, "a notification is shown").not.toBeNull();
      expect(note, "the notification points at the key pref").toContain(
        "about:config",
      );
      expect(note).toContain(API_KEY);
    } finally {
      await zen.setPref(API_KEY, savedKey);
      await zen.restoreFetch();
    }
  });

  // TIDY-10: a successful run reports how many tabs went into how many groups.
  test("notifies success with the tab and group counts", async ({ zen }) => {
    await zen.openTabs(4, "Success ");
    await zen.installFetchStub(PLAN);
    try {
      await zen.clickButton();
      await zen.driver.wait(
        async () => {
          const note = await zen.lastNotification();
          return note != null && /Sorted \d+ tabs into \d+ groups\./.test(note);
        },
        20_000,
        "no success notification was shown",
        200,
      );
    } finally {
      await zen.restoreFetch();
    }
  });

  // TIDY-10: a failed run surfaces the failure.
  test("notifies failure when the model call fails", async ({ zen }) => {
    await zen.openTabs(4, "Failure ");
    await zen.installFetchErrorStub(500, "boom");
    try {
      await zen.clickButton();
      await zen.driver.wait(
        async () => {
          const note = await zen.lastNotification();
          return note != null && /failed/i.test(note);
        },
        20_000,
        "no failure notification was shown",
        200,
      );
    } finally {
      await zen.restoreFetch();
    }
  });

  // TIDY-10: when group creation silently fails (addTabGroup returns falsy rather
  // than throwing), the run must surface failure, not a false success.
  test("notifies failure when group creation silently fails", async ({
    zen,
  }) => {
    await zen.openTabs(4, "Silent ");
    await zen.installFetchStub(PLAN);
    await zen.exec(() => {
      window.__zenTidyTabsOrigAddTabGroup = gBrowser.addTabGroup;
      gBrowser.addTabGroup = () => null;
      return true;
    });
    try {
      await zen.clickButton();
      await zen.driver.wait(
        async () => {
          const note = await zen.lastNotification();
          return note != null && /failed/i.test(note);
        },
        20_000,
        "no failure notification was shown",
        200,
      );
      expect(
        await zen.groupLabels(),
        "no groups exist after a failed creation",
      ).toEqual([]);
    } finally {
      await zen.exec(() => {
        if (window.__zenTidyTabsOrigAddTabGroup) {
          gBrowser.addTabGroup = window.__zenTidyTabsOrigAddTabGroup;
          window.__zenTidyTabsOrigAddTabGroup = undefined;
        }
        return true;
      });
      await zen.restoreFetch();
    }
  });

  // TIDY-14: a notification's auto-dismiss removes only itself, never a later one.
  // With one eligible tab every Tidy click bails on the minimum (TIDY-4) and shows a
  // fresh notification. We reproduce the real cross-test interference: a notification
  // is cleared from the box (as beforeEach does between tests) while its auto-dismiss
  // timer is still pending, then a later notification takes the shared value slot.
  test("a notification's auto-dismiss never removes a later notification", async ({
    zen,
  }) => {
    await zen.openTabs(1, "Notify ");

    // Notification A; its auto-dismiss timer (notifyDurationMs from now) is scheduled.
    await zen.clickButton();
    await zen.driver.wait(
      async () => (await zen.lastNotification()) != null,
      15_000,
      "the first notification never appeared",
      100,
    );

    // Remove A from the box without cancelling its pending timer — exactly what the
    // beforeEach clear does between real tests.
    await zen.clearNotifications();

    // Show notification B in the now-empty box. B reuses A's shared value but is a
    // distinct element, so A's stale value-based timer would target B.
    await zen.driver.sleep(3_500);
    await zen.clickButton();
    await zen.driver.wait(
      async () => (await zen.lastNotification()) != null,
      15_000,
      "the second notification never appeared",
      100,
    );

    // Past when A's timer fires, but well before B's: value-removal deletes the only
    // notification carrying the shared value (= B); each-dismisses-itself keeps B.
    await zen.driver.sleep(4_000);
    expect(
      await zen.lastNotification(),
      "the later notification survives the earlier one's auto-dismiss",
    ).not.toBeNull();
  });
});
