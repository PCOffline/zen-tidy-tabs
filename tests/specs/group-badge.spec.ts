import { expect, test } from "../src/fixtures";

// Real pointer/keyboard input is unreliable headless (popups don't open, native
// clicks miss), so the real-input specs below self-skip there.
const HEADLESS = process.env.ZEN_HEADLESS === "1";

test.describe("Group badge editing", () => {
  test.beforeEach(async ({ zen }) => {
    await zen.reset();
  });

  test.afterEach(async ({ zen }) => {
    // Right-click tests leave Zen's native panel open; dismiss it so it can't
    // bleed into the next test.
    await zen.closeEditPanel().catch(() => undefined);
  });

  // ---- left click: inline rename ------------------------------------------

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
    // A left click stays inline; it must never open the native panel.
    expect(await zen.editPanelOpen()).toBe(false);

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

  // ---- right click: native edit panel -------------------------------------

  test("right-clicking the group badge opens Zen's native edit panel", async ({
    zen,
  }) => {
    const original = "Right Me";
    await zen.createGroup(original, "blue", 2);

    // A right click must never start an inline edit, not even transiently. This
    // is checked synchronously with the gesture (in one chrome call), because
    // the script opens the native panel on a deferred tick and opening it tears
    // a stray inline edit back down -- a later check would miss it and pass
    // while the badge was visibly broken by hand.
    const startedInline = await zen.rightClickStartedInlineEdit(original);
    test.info().annotations.push({
      type: "interaction",
      description: "faithful right-click (full button-2 sequence)",
    });
    expect(startedInline).toBe(false);

    // A single right click opens the real native panel (it used to take two).
    await zen.waitForEditPanel();
    expect(await zen.editPanelOpen()).toBe(true);
    expect(await zen.inlineInputExists(original)).toBe(false);
  });

  test("right-clicking mid-rename opens the native panel and ends the inline edit", async ({
    zen,
  }) => {
    const original = "Switch To Panel";
    await zen.createGroup(original, "blue", 2);

    // Enter inline edit, then right-click. Mid-rename the badge shows the HTML
    // input (the XUL label is hidden), so the right click lands on the input --
    // it must still hand off to the native panel and tear the inline edit down.
    await zen.clickLabelOnce(original);
    await zen.driver.wait(
      async () => await zen.labelIsEditing(original),
      5_000,
      "badge did not enter inline-edit mode before the right click",
      150,
    );

    await zen.rightClickInlineInput(original);
    await zen.waitForEditPanel();
    expect(await zen.editPanelOpen()).toBe(true);
    expect(await zen.labelIsEditing(original)).toBe(false);
  });

  // ---- durability: rapid and erratic gestures ------------------------------

  test("spam left-clicks keep the badge inline and never open the panel", async ({
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
    expect(await zen.editPanelOpen()).toBe(false);

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

  test("double left-click stays inline and never opens the panel", async ({
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
    expect(await zen.editPanelOpen()).toBe(false);
    expect(await zen.groupLabelExists(original)).toBe(true);
  });

  test("clicking the inline input never collapses the group", async ({
    zen,
  }) => {
    // BADGE-8. The second click of a double-click lands on the inline input
    // (the badge is hidden behind it). It must not reach Zen's tab-group
    // handler, which would collapse the group and leave the badge stuck in its
    // collapsed, selected-looking style.
    const original = "No Collapse";
    await zen.createGroup(original, "blue", 2);

    await zen.clickLabelOnce(original);
    await zen.driver.wait(
      async () => await zen.labelIsEditing(original),
      5_000,
      "badge did not enter inline-edit mode after a left click",
      150,
    );
    expect(await zen.groupIsCollapsed(original)).toBe(false);

    expect(await zen.clickInlineInput()).toBe(true);

    await zen.driver.sleep(200);
    expect(await zen.groupIsCollapsed(original)).toBe(false);
    expect(await zen.labelIsEditing(original)).toBe(true);
  });

  test("erratic alternating clicks never leave a stuck inline edit", async ({
    zen,
  }) => {
    const original = "Erratic";
    await zen.createGroup(original, "blue", 2);

    // 10 alternating left/right gestures. Right-click opens Zen's native panel
    // (covered on its own above); here we only care that hammering the badge
    // never strands it mid-rename.
    const how = await zen.alternateClicksLabel(original, 10);
    test.info().annotations.push({ type: "interaction", description: how });

    await zen.driver.wait(
      async () => !(await zen.labelIsEditing(original)),
      5_000,
      "erratic gestures left a stuck inline edit",
      150,
    );
    expect(await zen.labelIsEditing(original)).toBe(false);
    expect(await zen.groupLabelExists(original)).toBe(true);
  });

  test("inline edit disables window-dragging on the empty sidebar", async ({
    zen,
  }) => {
    // BADGE-7. Zen's empty sidebar (.zen-workspace-empty-space) is a
    // -moz-window-dragging:drag region, so a real click there is taken by the
    // window manager and never reaches the click-away handler -- leaving the
    // edit stuck. While editing, the script marks the chrome root and forces
    // that region to no-drag so a single click still dismisses.
    const original = "Drag Region";
    await zen.createGroup(original, "blue", 2);

    // Baseline: not editing -> no marker.
    expect(await zen.editingRootMarked()).toBe(false);

    await zen.clickLabelOnce(original);
    await zen.driver.wait(
      async () => await zen.inlineInputExists(original),
      5_000,
      "badge did not enter inline-edit mode",
      150,
    );

    // While editing: the root is marked, so the BADGE-7 rule (present in the
    // injected CSS) now applies to the empty sidebar. Gecko doesn't expose
    // -moz-window-dragging via getComputedStyle, so we verify both halves of the
    // mechanism -- the marker and the rule -- rather than the resolved value.
    expect(await zen.editingRootMarked()).toBe(true);
    expect(await zen.hasDragOverrideRule()).toBe(true);

    // After the edit ends, the override is removed.
    await zen.commitInlineRename(original, "Drag Done");
    await zen.driver.wait(
      async () => !(await zen.editingRootMarked()),
      5_000,
      "inline-edit marker was not cleared after the edit ended",
      150,
    );
    expect(await zen.editingRootMarked()).toBe(false);
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

  // ---- real pointer + keyboard (headed only) ------------------------------
  // Synthetic events can't reproduce the real-only bugs this rework fixed (a
  // XUL label ignoring focus; a non-focusable click-away failing to blur the
  // HTML input; a right-click mid-edit landing on the input, not the label), so
  // these drive Zen with the actual WebDriver pointer + keyboard. This is the
  // path a person actually takes, and what manual testing exercised.

  test("a real left click + typing renames the group", async ({ zen }) => {
    test.skip(HEADLESS, "needs real pointer/keyboard input");
    const original = "Real Rename";
    await zen.createGroup(original, "blue", 2);

    await zen.realRenameInline(original, "Really Renamed");

    await zen.driver.wait(
      async () => await zen.groupLabelExists("Really Renamed"),
      5_000,
      "a real click + typing did not rename the group",
      150,
    );
    expect(await zen.groupLabelExists("Really Renamed")).toBe(true);
    expect(await zen.groupLabelExists(original)).toBe(false);
  });

  test("a single real click away saves the inline edit", async ({ zen }) => {
    test.skip(HEADLESS, "needs real pointer input");
    const original = "Click Away";
    await zen.createGroup(original, "blue", 2);

    await zen.realClickLabel(original);
    await zen.driver.wait(
      async () => await zen.labelIsEditing(original),
      5_000,
      "a real left click did not enter inline-edit mode",
      150,
    );

    const renamed = "Saved By Click Away";
    await zen.typeInline(renamed);

    // One click away is enough to exit; it used to take two.
    await zen.realClickAway();
    await zen.driver.wait(
      async () => !(await zen.labelIsEditing(original)),
      5_000,
      "a single real click away did not leave inline-edit mode",
      150,
    );
    expect(await zen.labelIsEditing(original)).toBe(false);

    await zen.driver.wait(
      async () => await zen.groupLabelExists(renamed),
      5_000,
      "a single real click away did not save the typed name",
      150,
    );
    expect(await zen.groupLabelExists(renamed)).toBe(true);
    expect(await zen.groupLabelExists(original)).toBe(false);
  });

  test("the inline input hugs its text and grows as you type", async ({
    zen,
  }) => {
    test.skip(HEADLESS, "needs real layout");
    const original = "Hi";
    await zen.createGroup(original, "blue", 2);

    await zen.realClickLabel(original);
    await zen.driver.wait(
      async () => await zen.labelIsEditing(original),
      5_000,
      "a real left click did not enter inline-edit mode",
      150,
    );

    const short = await zen.inlineMetrics(original);
    // A short name must not balloon the field to the full sidebar width.
    expect(short.input).toBeGreaterThan(0);
    expect(short.input).toBeLessThan(short.strip * 0.6);

    // Typing a longer name grows the field, but it still never overflows.
    await zen.setInlineValue(original, "a considerably longer group name");
    const long = await zen.inlineMetrics(original);
    expect(long.input).toBeGreaterThan(short.input);
    expect(long.input).toBeLessThanOrEqual(long.strip);
  });
});
