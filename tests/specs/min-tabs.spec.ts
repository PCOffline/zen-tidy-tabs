import { expect, test } from "../src/fixtures";

// CONFIG.grouping.minTabs in index.uc.js — runTidy() refuses to tidy fewer than
// this many eligible tabs, and bails *before* contacting the model.
const MIN_TABS = 3;

test.describe("Minimum tabs", () => {
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

  // Boundary (refuse): one below the minimum still refuses and never calls the
  // model — catches an off-by-one in the `< minTabs` check.
  test("refuses at one tab below the minimum", async ({ zen }) => {
    await zen.openTabs(MIN_TABS - 1, "Pair ");
    const n = await zen.collectCount();
    expect(n, `exactly ${MIN_TABS - 1} eligible tabs (below the minimum)`).toBe(
      MIN_TABS - 1,
    );

    await zen.installFetchStub({ groups: [{ name: "Nope", tabs: [0, 1] }] });
    try {
      await zen.clickButton();
      // Bails synchronously after the min-tabs check; give it a beat to prove no
      // async model call ever happens.
      await zen.driver.sleep(1500);
      expect(
        await zen.fetchStubCallCount(),
        "the model must not be called one tab below the minimum",
      ).toBe(0);
    } finally {
      await zen.restoreFetch();
    }
  });

  // Boundary (proceed): exactly the minimum proceeds and reaches the model.
  test("proceeds at exactly the minimum and reaches the model", async ({
    zen,
  }) => {
    await zen.openTabs(MIN_TABS, "Trio ");
    const n = await zen.collectCount();
    expect(n, `exactly the ${MIN_TABS}-tab minimum`).toBe(MIN_TABS);

    await zen.installFetchStub({ groups: [{ name: "Trio", tabs: [0, 1, 2] }] });
    try {
      await zen.clickButton();
      await zen.driver.wait(
        async () => (await zen.fetchStubCallCount()) >= 1,
        15_000,
        "the model was never called at the minimum tab count",
        200,
      );
    } finally {
      await zen.restoreFetch();
    }
  });
});
