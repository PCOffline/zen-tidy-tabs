import { expect, test } from "../src/fixtures";

test.describe("Group badge editing", () => {
  test.beforeEach(async ({ zen }) => {
    await zen.reset();
  });

  test("single-clicking the group badge renames it inline", async ({ zen }) => {
    const original = "Rename Me";
    await zen.createGroup(original, "blue", 2);

    const how = await zen.clickLabelOnce(original);
    test.info().annotations.push({ type: "interaction", description: how });

    // The script debounces single vs double click for 300ms before entering
    // inline-edit mode; wait it out, then confirm the badge is editable.
    await zen.driver.wait(
      async () => await zen.labelIsEditing(original),
      5_000,
      "badge did not enter inline-edit mode after a single click",
      150,
    );

    const renamed = "Renamed Inline";
    await zen.commitInlineRename(original, renamed);

    await zen.driver.wait(
      async () => await zen.groupLabelExists(renamed),
      5_000,
      `group was not renamed to "${renamed}"`,
      150,
    );

    expect(await zen.groupLabelExists(renamed)).toBe(true);
    expect(await zen.groupLabelExists(original)).toBe(false);
  });

  test("double-clicking the group badge opens the edit modal (rename + recolor)", async ({
    zen,
  }) => {
    const original = "Double Me";
    await zen.createGroup(original, "blue", 2);

    const how = await zen.doubleClickLabel(original);
    test.info().annotations.push({ type: "interaction", description: how });

    await zen.waitForOverlay();
    expect(await zen.overlayTitle()).toBe("Edit group");

    // Rename + pick a different color, then save.
    const renamed = "Double Renamed";
    const newColor = "green";
    await zen.fillModalName(renamed);
    await zen.pickSwatch(newColor);
    await zen.clickPrimary();

    await zen.waitForNoOverlay();

    await zen.driver.wait(
      async () => await zen.groupLabelExists(renamed),
      5_000,
      `group was not renamed to "${renamed}" via the modal`,
      150,
    );

    expect(await zen.groupLabelExists(renamed)).toBe(true);
    expect(await zen.groupColor(renamed)).toBe(newColor);
  });
});
