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

/**
 * Build a plan that overflows the single-tab budget (TIDY-13): one multi-tab
 * group seeds a budget of exactly one singleton, the first ungrouped singleton
 * is kept, and every later singleton must collapse into a trailing "Other".
 */
function singletonBudgetPlan(n: number): {
  grouping: GroupingPlan;
  present: string[];
  collapsed: string[];
} {
  const groups = [{ name: "Pair", tabs: [0, 1] }];
  const present = ["Pair"];
  const collapsed: string[] = [];
  for (let i = 2; i < n; i++) {
    const name = i === 2 ? "Keep One" : `Drop ${i}`;
    groups.push({ name, tabs: [i] });
    if (i === 2) {
      present.push(name);
    } else {
      collapsed.push(name);
    }
  }
  // Surplus singletons (and any omitted tab) land in "Other".
  if (collapsed.length > 0) {
    present.push("Other");
  }
  return { grouping: { groups }, present, collapsed };
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

  test("collapses surplus single-tab groups into Other", async ({ zen }) => {
    // TIDY-13: at most (multi-tab group count) single-tab groups survive; the
    // rest fold into a trailing "Other" group.
    await zen.openTabs(5, "Budget Page ");
    const n = await zen.collectCount();
    expect(
      n,
      "need enough tabs to overflow the singleton budget",
    ).toBeGreaterThanOrEqual(4);

    const { grouping, present, collapsed } = singletonBudgetPlan(n);
    await zen.installFetchStub(grouping);

    try {
      await zen.clickButton();

      await zen.driver.wait(
        async () => {
          const labels = await zen.groupLabels();
          return present.every((name) => labels.includes(name));
        },
        30_000,
        `expected groups ${present.join(", ")} were not created`,
        400,
      );

      const labels = await zen.groupLabels();
      for (const name of present) {
        expect(labels, `group "${name}" exists`).toContain(name);
      }
      for (const name of collapsed) {
        expect(
          labels,
          `surplus singleton "${name}" was collapsed into Other`,
        ).not.toContain(name);
      }
      expect(
        await zen.groupTabCount("Other"),
        "Other holds the collapsed singletons",
      ).toBe(collapsed.length);
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

  // TIDY-19: a new group that sorts before a kept group in plan order must not
  // be handed the kept group's colour.
  test("a re-tidy never gives a new group a kept group's colour", async ({
    zen,
  }) => {
    await zen.openTabs(6, "Colour Page ");
    const n = await zen.collectCount();
    expect(n, "should have tabs to tidy").toBeGreaterThanOrEqual(6);

    // First tidy into two groups. "Keep" sorts first, so it draws the palette's
    // first colour and "Temp" the second.
    const first: GroupingPlan = {
      groups: [
        { name: "Keep", tabs: [0, 1, 2] },
        { name: "Temp", tabs: [3, 4, 5] },
      ],
    };
    await zen.installFetchStub(first);
    try {
      await zen.clickButton();
      await zen.driver.wait(
        async () => {
          const labels = await zen.groupLabels();
          return labels.includes("Keep") && labels.includes("Temp");
        },
        30_000,
        "first tidy did not create Keep and Temp",
        400,
      );
    } finally {
      await zen.restoreFetch();
    }

    const keptColour = await zen.groupColor("Keep");
    expect(keptColour, "kept group has a colour").not.toBe("");

    // Re-tidy: a brand-new group ("Fresh") sorts BEFORE the kept group ("Keep"),
    // so its colour is picked before the reconcile loop reaches Keep. Before the
    // fix, that handed Fresh the very colour Keep still wears.
    const second: GroupingPlan = {
      groups: [
        { name: "Fresh", tabs: [3, 4, 5] },
        { name: "Keep", tabs: [0, 1, 2] },
      ],
    };
    await zen.installFetchStub(second);
    try {
      await zen.clickButton();
      await zen.driver.wait(
        async () => {
          const labels = await zen.groupLabels();
          return (
            labels.includes("Fresh") &&
            labels.includes("Keep") &&
            !labels.includes("Temp")
          );
        },
        30_000,
        "re-tidy did not converge to Fresh and Keep",
        400,
      );
    } finally {
      await zen.restoreFetch();
    }

    const freshColour = await zen.groupColor("Fresh");
    expect(freshColour, "new group has a colour").not.toBe("");
    expect(
      freshColour,
      "a new group never reuses the kept group's colour",
    ).not.toBe(keptColour);
  });
});
