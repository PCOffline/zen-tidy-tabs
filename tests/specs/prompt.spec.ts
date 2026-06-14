import { expect, test } from "../src/fixtures";

// TIDY-6: the prompt caps the group count at clamp(ceil(tabCount/3), 2, 8) and
// carries the grouping rubric (group by activity, Title Case 1-3 word names,
// expandable categories over single-tab descriptions, "Other" as a last resort,
// grounded in the supplied titles/URLs).
const PLAN = { groups: [{ name: "Anything", tabs: [0, 1, 2] }] };

/** clamp(ceil(n / 3), 2, 8) — the cap the prompt should advertise. */
function expectedMaxGroups(n: number): number {
  return Math.min(8, Math.max(2, Math.ceil(n / 3)));
}

async function capturePrompt(
  zen: import("../src/zen-driver").ZenDriver,
): Promise<{ prompt: string; tabCount: number }> {
  await zen.installFetchStub(PLAN);
  await zen.clickButton();
  await zen.driver.wait(
    async () => (await zen.fetchStubCallCount()) >= 1,
    15_000,
    "the model was never called",
    200,
  );
  const prompt = await zen.lastRequestPrompt();
  const tabCount = (await zen.lastRequestSnapshot()).length;
  return { prompt, tabCount };
}

test.describe("Tidy prompt", () => {
  test.beforeEach(async ({ zen }) => {
    await zen.reset();
  });

  // Floor branch: with few tabs the cap clamps up to the minimum of 2.
  test("caps the group count (floor) at clamp(ceil(tabCount/3), 2, 8)", async ({
    zen,
  }) => {
    await zen.openTabs(4, "Few ");
    try {
      const { prompt, tabCount } = await capturePrompt(zen);
      const cap = expectedMaxGroups(tabCount);
      expect(cap, "few tabs clamp up to the floor of 2").toBe(2);
      expect(prompt).toContain(`between 1 and ${cap} groups`);
    } finally {
      await zen.restoreFetch();
    }
  });

  // Scaling branch: with more tabs the cap grows as ceil(tabCount / 3).
  test("scales the group count cap with the tab count", async ({ zen }) => {
    await zen.openTabs(9, "Many ");
    try {
      const { prompt, tabCount } = await capturePrompt(zen);
      const cap = expectedMaxGroups(tabCount);
      expect(cap, "the cap scales above the floor").toBeGreaterThan(2);
      expect(prompt).toContain(`between 1 and ${cap} groups`);
    } finally {
      await zen.restoreFetch();
    }
  });

  // The rubric: group by activity, Title-Case 1-3 word names, expandable
  // categories over one-tab descriptions, "Other" as a last resort, grounded in
  // the supplied tabs.
  test("carries the grouping and naming rubric", async ({ zen }) => {
    await zen.openTabs(4, "Rubric ");
    try {
      const { prompt } = await capturePrompt(zen);

      // Group by what the user is doing.
      expect(prompt).toContain("Group by what the user is DOING");
      // 1-3 word Title Case names.
      expect(prompt).toContain("Title Case");
      expect(prompt).toContain("1-3 words");
      // Expandable categories, not single-tab descriptions.
      expect(prompt).toContain("EXPANDABLE CATEGORY");
      expect(prompt).toContain("Prefer multi-tab groups");
      // "Other" is the last-resort catch-all.
      expect(prompt).toContain('"Other"');
      expect(prompt).toContain("LAST RESORT");
      // Grounded in the supplied titles/URLs.
      expect(prompt).toContain("Use ONLY the titles and URLs given");
      expect(prompt).toContain("Every group must be justified by its members");
    } finally {
      await zen.restoreFetch();
    }
  });
});
