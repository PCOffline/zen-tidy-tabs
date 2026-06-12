import { expect, test } from "../src/fixtures";

test.describe("Group badge editing", () => {
  test.beforeEach(async ({ zen }) => {
    await zen.reset();
  });

  test("left-clicking the group badge renames it inline", async ({ zen }) => {
    const original = "Rename Me";
    await zen.createGroup(original, "blue", 2);

    const how = await zen.clickLabelOnce(original);
    test.info().annotations.push({ type: "interaction", description: how });

    await zen.driver.wait(
      async () => await zen.labelIsEditing(original),
      5_000,
      "badge did not enter inline-edit mode after a left click",
      150,
    );
    expect(await zen.overlayExists()).toBe(false);

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

  test("right-clicking the group badge opens the edit modal (rename + recolor)", async ({
    zen,
  }) => {
    const original = "Right Me";
    await zen.createGroup(original, "blue", 2);

    const how = await zen.rightClickLabel(original);
    test.info().annotations.push({ type: "interaction", description: how });

    await zen.waitForOverlay();
    expect(await zen.overlayTitle()).toBe("Edit group");
    expect(await zen.labelIsEditing(original)).toBe(false);

    const renamed = "Right Renamed";
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

  // ---- durability: rapid and erratic gestures ------------------------------

  test("spam left-clicks keep the badge inline and never open the modal", async ({
    zen,
  }) => {
    const original = "Spam Left";
    await zen.createGroup(original, "blue", 2);

    const how = await zen.spamClickLabel(original, 12);
    test.info().annotations.push({ type: "interaction", description: how });

    await zen.driver.wait(
      async () => await zen.labelIsEditing(original),
      5_000,
      "badge was not in inline-edit mode after spam left-clicks",
      150,
    );
    expect(await zen.overlayExists()).toBe(false);

    // The badge is still usable: a rename commits cleanly.
    const renamed = "Survived Spam";
    await zen.commitInlineRename(original, renamed);
    await zen.driver.wait(
      async () => await zen.groupLabelExists(renamed),
      5_000,
      `group was not renamed to "${renamed}" after spam clicks`,
      150,
    );
    expect(await zen.groupLabelExists(renamed)).toBe(true);
  });

  test("double left-click stays inline and never opens the modal", async ({
    zen,
  }) => {
    const original = "Double Left";
    await zen.createGroup(original, "blue", 2);

    const how = await zen.doubleClickLabel(original);
    test.info().annotations.push({ type: "interaction", description: how });

    await zen.driver.wait(
      async () => await zen.labelIsEditing(original),
      5_000,
      "badge was not in inline-edit mode after a double left-click",
      150,
    );
    expect(await zen.overlayExists()).toBe(false);
    expect(await zen.groupLabelExists(original)).toBe(true);
  });

  test("erratic alternating clicks end in a single edit modal", async ({
    zen,
  }) => {
    const original = "Erratic";
    await zen.createGroup(original, "blue", 2);

    // 10 alternating gestures, ending on a right-click.
    const how = await zen.alternateClicksLabel(original, 10);
    test.info().annotations.push({ type: "interaction", description: how });

    await zen.waitForOverlay();
    expect(await zen.overlayTitle()).toBe("Edit group");
    expect(await zen.modalCount()).toBe(1);
    expect(await zen.labelIsEditing(original)).toBe(false);

    await zen.pressEscape();
    await zen.waitForNoOverlay();
    expect(await zen.groupLabelExists(original)).toBe(true);
    expect(await zen.labelIsEditing(original)).toBe(false);
  });

  test("pressing Escape during inline rename keeps the original name", async ({
    zen,
  }) => {
    const original = "Keep Me";
    await zen.createGroup(original, "blue", 2);

    const how = await zen.clickLabelOnce(original);
    test.info().annotations.push({ type: "interaction", description: how });

    await zen.driver.wait(
      async () => await zen.labelIsEditing(original),
      5_000,
      "badge did not enter inline-edit mode after a left click",
      150,
    );

    // Type a new name, then abandon the edit with Escape.
    await zen.cancelInlineRename(original, "Typed But Discarded");

    // Give the commit/blur handlers a beat, then confirm nothing changed.
    await zen.driver.sleep(400);
    expect(await zen.groupLabelExists(original)).toBe(true);
    expect(await zen.groupLabelExists("Typed But Discarded")).toBe(false);
    expect(await zen.labelIsEditing(original)).toBe(false);
  });
});
