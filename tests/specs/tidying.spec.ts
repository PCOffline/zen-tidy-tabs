import { expect, test } from "../src/fixtures";
import type { GroupingPlan } from "../src/zen-driver";

/**
 * Build a deterministic two-group plan covering tab indices 0..n-1, matching
 * the schema ai.parseGroups() expects: { groups: [{ name, tabs: [idx...] }] }.
 */
function twoGroupPlan(n: number): {
  grouping: GroupingPlan;
  expected: string[];
} {
  const half = Math.max(1, Math.floor(n / 2));
  const research: number[] = [];
  const reading: number[] = [];
  for (let i = 0; i < n; i++) {
    (i < half ? research : reading).push(i);
  }
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

/**
 * Build a two-group plan over tab indices 0..n-1 using the supplied names, so a
 * re-tidy can reorganize the SAME tabs into differently-named groups.
 */
function renamedPlan(
  n: number,
  names: [string, string],
): { grouping: GroupingPlan; expected: string[] } {
  const half = Math.max(1, Math.floor(n / 2));
  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < n; i++) {
    (i < half ? a : b).push(i);
  }
  return {
    grouping: {
      groups: [
        { name: names[0], tabs: a },
        { name: names[1], tabs: b },
      ],
    },
    expected: [...names],
  };
}

test.describe("Tidying", () => {
  test.beforeEach(async ({ zen }) => {
    await zen.reset();
  });

  test("collecting skips pinned, empty, and glance tabs", async ({ zen }) => {
    // TIDY-3: collect() excludes tabs that are pinned, Zen empty, or Zen glance.
    // Arrange: a known set of plain, eligible tabs.
    await zen.openTabs(4, "Eligible ");
    const eligibleBefore = await zen.collectCount();
    const totalBefore = await zen.totalTabCount();

    // Act: add one pinned, one empty, and one glance tab -- all ineligible.
    const added = await zen.openIneligibleTabs();

    // Assert: the window really grew by the ineligible tabs, yet not one of them
    // is collected, so the eligible count is unchanged.
    const totalAfter = await zen.totalTabCount();
    const eligibleAfter = await zen.collectCount();
    expect(
      totalAfter - totalBefore,
      "the ineligible tabs were actually opened",
    ).toBe(added);
    expect(
      eligibleAfter,
      "pinned, empty, and glance tabs are never collected",
    ).toBe(eligibleBefore);
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
        400,
      );

      const labels = await zen.groupLabels();
      for (const name of expected) {
        expect(labels, `group "${name}" exists`).toContain(name);
        expect(
          await zen.groupTabCount(name),
          `group "${name}" has tabs`,
        ).toBeGreaterThan(0);
      }
    } finally {
      await zen.restoreFetch();
    }
  });

  test("re-tidying never paints the old groups beneath the new ones", async ({
    zen,
  }) => {
    // TIDY-12 (re-tidy reconsiders already-grouped tabs), TIDY-7, TIDY-9.
    // Arrange: tidy once into two known groups.
    await zen.openTabs(6, "Re-tidy Page ");
    const n = await zen.collectCount();
    expect(n, "should have tabs to tidy").toBeGreaterThanOrEqual(2);

    const first = renamedPlan(n, ["Research", "Reading"]);
    await zen.installFetchStub(first.grouping);
    try {
      await zen.clickButton();
      await zen.driver.wait(
        async () => {
          const labels = await zen.groupLabels();
          return first.expected.every((name) => labels.includes(name));
        },
        30_000,
        `first tidy did not create ${first.expected.join(", ")}`,
        400,
      );
    } finally {
      await zen.restoreFetch();
    }

    // Act: re-tidy the SAME tabs into differently-named groups. This abandons
    // the original groups, which is exactly the situation that used to leave
    // emptied husks painted beneath the freshly built groups for a frame. The
    // watcher samples the DOM on every mutation across the whole operation.
    const second = renamedPlan(n, ["Work", "Personal"]);
    await zen.startReTidyWatch();
    await zen.installFetchStub(second.grouping);
    let report: Awaited<ReturnType<typeof zen.stopReTidyWatch>>;
    try {
      await zen.clickButton();
      await zen.driver.wait(
        async () => {
          const labels = await zen.groupLabels();
          return (
            second.expected.every((name) => labels.includes(name)) &&
            first.expected.every((name) => !labels.includes(name))
          );
        },
        30_000,
        `re-tidy did not converge to ${second.expected.join(", ")}`,
        400,
      );
    } finally {
      report = await zen.stopReTidyWatch();
      await zen.restoreFetch();
    }

    // Assert: at no observed moment did more than the two planned groups exist,
    // and no group label was ever duplicated. Either would mean the old groups
    // were still on screen while the new ones were built -- the re-tidy flicker.
    expect(
      report.maxLabelled,
      `never more than ${second.expected.length} groups at once (peak labels: ${report.labelsAtPeak.join(", ")})`,
    ).toBeLessThanOrEqual(second.expected.length);
    expect(
      report.maxDuplicate,
      "no group label was ever duplicated mid-retidy",
    ).toBe(1);

    // And the end state is exactly the re-tidied groups.
    const labels = await zen.groupLabels();
    for (const name of second.expected) {
      expect(labels, `group "${name}" exists`).toContain(name);
      expect(
        await zen.groupTabCount(name),
        `group "${name}" has tabs`,
      ).toBeGreaterThan(0);
    }
    for (const name of first.expected) {
      expect(labels, `old group "${name}" is gone`).not.toContain(name);
    }
  });
});
