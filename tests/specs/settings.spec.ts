import { expect, test } from "../src/fixtures";

test.describe("Settings", () => {
  test.beforeEach(async ({ zen }) => {
    await zen.reset();
  });

  test("right-clicking the button opens the Zen Tidy Tabs configuration", async ({
    zen,
  }) => {
    const how = await zen.rightClickButton();
    test.info().annotations.push({ type: "interaction", description: how });

    await zen.waitForOverlay();
    expect(await zen.overlayTitle()).toBe("Zen Tidy Tabs Settings");

    // The settings modal exposes the OpenRouter API key (a password field).
    expect(
      await zen.hasModalPasswordField(),
      "settings modal shows the API key field",
    ).toBe(true);

    // Clean up so the modal doesn't leak into the next test.
    await zen.pressEscape();
    await zen.waitForNoOverlay();
  });
});
