import { expect, test } from "../src/fixtures";

// CONFIG.grouping.minTabs in index.uc.js — runTidy() refuses to tidy fewer than
// this many eligible tabs, and bails *before* contacting the model.
const MIN_TABS = 3;

test.describe("Minimum tabs", () => {
  test.beforeEach(async ({ zen }) => {
    await zen.reset();
  });

  test("refuses to tidy below the minimum and never calls the model", async ({
    zen,
  }) => {
    // Arrange: keep the eligible-tab count under the minimum.
    await zen.openTabs(1, "Lonely ");
    const n = await zen.collectCount();
    expect(
      n,
      `precondition: fewer than the ${MIN_TABS}-tab minimum`,
    ).toBeLessThan(MIN_TABS);

    // A stub that *would* group the tabs if the model were ever consulted.
    await zen.installFetchStub({ groups: [{ name: "Nope", tabs: [0, 1] }] });

    try {
      const how = await zen.clickButton();
      test.info().annotations.push({ type: "interaction", description: how });

      // runTidy() bails synchronously after the min-tabs check; give it a beat
      // to prove nothing async (a model call, group creation) ever happens.
      await zen.driver.sleep(1500);

      expect(
        await zen.fetchStubCallCount(),
        "the model must not be called when below the minimum",
      ).toBe(0);
      expect(await zen.groupLabels(), "no tab groups are created").toEqual([]);
    } finally {
      await zen.restoreFetch();
    }
  });
});
