import { expect, test } from "../src/fixtures";

// The snapshot the script sends to the model: one {i, title, url?, group?}
// entry per eligible tab (TIDY-5), with the url shaped by the privacy
// preference (zen-tidy-tabs.urlmode) and an unrecognised mode falling back to
// "detailed" (PREFS-1).
const URL_MODE = "zen-tidy-tabs.urlmode";

/** A trivial plan; these tests only inspect the request, not the result. */
const PLAN = { groups: [{ name: "Anything", tabs: [0, 1, 2] }] };

test.describe("Model snapshot", () => {
  test.beforeEach(async ({ zen }) => {
    await zen.reset();
  });

  // TIDY-5: shape is {i, title, url?, group?}; query strings/hashes are stripped.
  test("the snapshot has the documented shape and strips query strings", async ({
    zen,
  }) => {
    await zen.openTabsRaw([
      "data:text/html,<title>Alpha</title>",
      "data:text/html,<title>Bravo</title>?token=secret",
      "data:text/html,<title>Charlie</title>#section-3",
    ]);

    await zen.installFetchStub(PLAN);
    try {
      await zen.clickButton();
      await zen.driver.wait(
        async () => (await zen.fetchStubCallCount()) >= 1,
        15_000,
        "the model was never called",
        200,
      );

      const snapshot = await zen.lastRequestSnapshot();
      expect(
        snapshot.length,
        "one entry per eligible tab",
      ).toBeGreaterThanOrEqual(3);

      // Every entry carries a numeric index and a string title; the indices are
      // a dense 0..n-1 range so parseGroups() can map them back to tabs.
      snapshot.forEach((entry, i) => {
        expect(entry.i, "entry index is sequential").toBe(i);
        expect(typeof entry.title, "entry has a string title").toBe("string");
        expect(Object.keys(entry).sort()).toEqual(
          expect.arrayContaining(["i", "title"]),
        );
        // Only the documented keys ever appear.
        for (const key of Object.keys(entry)) {
          expect(["i", "title", "url", "group"]).toContain(key);
        }
      });

      const titles = snapshot.map((e) => e.title);
      expect(
        titles.every((t) => typeof t === "string" && t.length > 0),
        "every entry has a non-empty title",
      ).toBe(true);

      // Query strings and hashes are never sent in the url (detailed is default).
      for (const entry of snapshot) {
        if (entry.url === undefined) {
          continue;
        }
        expect(entry.url, "no query string is sent").not.toContain("token=");
        expect(entry.url, "no query separator is sent").not.toContain("?");
        expect(entry.url, "no hash is sent").not.toContain("#");
      }
    } finally {
      await zen.restoreFetch();
    }
  });

  // TIDY-5: `group` is included only for already-grouped tabs, carrying the
  // group's current name as a stability hint.
  test("already-grouped tabs carry their group name and ungrouped tabs do not", async ({
    zen,
  }) => {
    await zen.createGroup("Stable", "blue", 2);
    await zen.openTabs(2, "Loose ");

    await zen.installFetchStub(PLAN);
    try {
      await zen.clickButton();
      await zen.driver.wait(
        async () => (await zen.fetchStubCallCount()) >= 1,
        15_000,
        "the model was never called",
        200,
      );

      const snapshot = await zen.lastRequestSnapshot();
      // Identify grouped tabs by the `group` field under test rather than by
      // title: headless does not render data: titles, so tab labels are
      // unreliable. Exactly the two tabs in "Stable" carry the hint.
      const withGroup = snapshot.filter((e) => e.group !== undefined);
      const withoutGroup = snapshot.filter((e) => e.group === undefined);

      expect(withGroup.length, "only the grouped tabs carry a hint").toBe(2);
      expect(
        withGroup.every((e) => e.group === "Stable"),
        "the hint is the group's current name",
      ).toBe(true);
      expect(
        withoutGroup.length,
        "the ungrouped tabs carry no group hint",
      ).toBeGreaterThanOrEqual(2);
    } finally {
      await zen.restoreFetch();
    }
  });

  // TIDY-5: urlmode controls whether the url is sent at all.
  test("the urlmode preference controls whether a url is sent", async ({
    zen,
  }) => {
    await zen.openTabs(4, "Privacy ");
    try {
      // detailed (default): a url is present for each entry.
      await zen.setPref(URL_MODE, "detailed");
      await zen.installFetchStub(PLAN);
      await zen.clickButton();
      await zen.driver.wait(
        async () => (await zen.fetchStubCallCount()) >= 1,
        15_000,
        "the model was never called (detailed)",
        200,
      );
      let snapshot = await zen.lastRequestSnapshot();
      expect(
        snapshot.every((e) => typeof e.url === "string" && e.url.length > 0),
        "detailed mode sends a url for every tab",
      ).toBe(true);

      // minimal: the url is omitted entirely.
      await zen.setPref(URL_MODE, "minimal");
      await zen.installFetchStub(PLAN);
      await zen.clickButton();
      await zen.driver.wait(
        async () => (await zen.fetchStubCallCount()) >= 1,
        15_000,
        "the model was never called (minimal)",
        200,
      );
      snapshot = await zen.lastRequestSnapshot();
      expect(
        snapshot.every((e) => e.url === undefined),
        "minimal mode sends no url",
      ).toBe(true);
    } finally {
      await zen.setPref(URL_MODE, "detailed");
      await zen.restoreFetch();
    }
  });

  // PREFS-1: an unrecognised urlmode value falls back to detailed (url sent),
  // not to minimal (url omitted).
  test("an unrecognised urlmode falls back to detailed", async ({ zen }) => {
    await zen.openTabs(4, "Fallback ");
    await zen.installFetchStub(PLAN);
    try {
      await zen.setPref(URL_MODE, "totally-bogus-mode");
      await zen.clickButton();
      await zen.driver.wait(
        async () => (await zen.fetchStubCallCount()) >= 1,
        15_000,
        "the model was never called",
        200,
      );

      const snapshot = await zen.lastRequestSnapshot();
      expect(
        snapshot.every((e) => typeof e.url === "string" && e.url.length > 0),
        "a bogus urlmode behaves like detailed and still sends urls",
      ).toBe(true);
    } finally {
      await zen.setPref(URL_MODE, "detailed");
      await zen.restoreFetch();
    }
  });
});
