import { expect, test } from "../src/fixtures";

// RELOAD-1: re-evaluating the script in the same window replaces the previous
// load cleanly. The most observable failure is a stray inline rename: a fresh
// `editor` object can't reach the previous load's open edit, so without explicit
// cleanup the old <input> stays in the DOM, the label stays hidden, and the
// BADGE-7 window-drag override is never cleared.
test.describe("Script re-evaluation", () => {
  test("re-evaluating the script clears a stray inline rename", async ({
    zen,
  }) => {
    const original = "Reload Group";
    await zen.createGroup(original, "blue", 2);

    // Open an inline rename and confirm the editing state is live.
    await zen.clickLabelOnce(original);
    await zen.driver.wait(
      async () => await zen.inlineInputExists(original),
      5_000,
      "badge did not enter inline-edit mode",
      150,
    );
    expect(await zen.editingRootMarked(), "editing root marker is set").toBe(
      true,
    );

    // Re-evaluate the whole userscript while the rename is still open.
    await zen.injectScript();

    expect(
      await zen.inlineInputExists(original),
      "the stray inline input is removed on re-eval",
    ).toBe(false);
    expect(
      await zen.editingRootMarked(),
      "the window-drag override class is cleared on re-eval",
    ).toBe(false);
    expect(
      await zen.groupLabels(),
      "the group itself survives the re-eval",
    ).toContain(original);
  });
});
