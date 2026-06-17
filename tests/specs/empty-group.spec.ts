import { expect, test } from "../src/fixtures";

test.describe("Empty group cleanup", () => {
  test("a group whose tabs all close is dissolved automatically", async ({
    zen,
  }) => {
    // Arrange: a real native group with a couple of tabs.
    await zen.createGroup("Disposable", "purple", 2);
    expect(await zen.groupLabelExists("Disposable")).toBe(true);

    // Act: close every tab in the group. The script's empty-group watcher
    // (installEmptyWatcher / removeEmpty) should then dissolve the husk.
    await zen.closeGroupTabs("Disposable");

    // Assert: the group disappears (the watcher debounces, so poll for it).
    await zen.driver.wait(
      async () => !(await zen.groupLabelExists("Disposable")),
      10_000,
      "emptied group was not dissolved automatically",
      250,
    );
    expect(await zen.groupLabelExists("Disposable")).toBe(false);
  });
});
