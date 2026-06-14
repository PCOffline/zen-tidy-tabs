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
});
