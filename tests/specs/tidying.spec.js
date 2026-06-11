// @ts-check
const { test, expect } = require("../src/fixtures");

/**
 * Build a deterministic two-group plan covering tab indices 0..n-1, matching
 * the schema ai.parseGroups() expects: { groups: [{ name, tabs: [idx...] }] }.
 */
function twoGroupPlan(n) {
  const half = Math.max(1, Math.floor(n / 2));
  const research = [];
  const reading = [];
  for (let i = 0; i < n; i++) (i < half ? research : reading).push(i);
  return {
    grouping: {
      groups: [
        { name: "Research", tabs: research },
        { name: "Reading", tabs: reading },
      ],
    },
    expected: ["Research", "Reading"],
  };
}

test.describe("Tidying", () => {
  test.beforeEach(async ({ zen }) => {
    await zen.reset();
  });

  test("tidying the tabs actually works", async ({ zen }) => {
    // Arrange: several ungrouped tabs and a stubbed OpenRouter response that
    // sorts them into two known groups.
    await zen.openTabs(4, "Tidy Page ");
    const n = await zen.collectCount();
    expect(n, "should have tabs to tidy").toBeGreaterThanOrEqual(2);

    const { grouping, expected } = twoGroupPlan(n);
    await zen.installFetchStub(grouping);

    try {
      // Act: click the real Tidy control.
      const how = await zen.clickButton();
      test.info().annotations.push({ type: "interaction", description: how });

      // Assert: the script created native tab groups with the planned names,
      // each containing tabs.
      await zen.driver.wait(
        async () => {
          const labels = await zen.groupLabels();
          return expected.every((name) => labels.includes(name));
        },
        30_000,
        `expected tab groups ${expected.join(", ")} were not created`,
        400
      );

      const labels = await zen.groupLabels();
      for (const name of expected) {
        expect(labels, `group "${name}" exists`).toContain(name);
        expect(
          await zen.groupTabCount(name),
          `group "${name}" has tabs`
        ).toBeGreaterThan(0);
      }
    } finally {
      await zen.restoreFetch();
    }
  });
});
