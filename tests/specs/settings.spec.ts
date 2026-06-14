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

  test("saved settings persist and are reflected when reopened", async ({
    zen,
  }) => {
    const apiKey = "sk-or-v1-persist-me";
    const model = "openai/gpt-4.1-mini";
    const prefs = {
      apiKey: "zen-tidy-tabs.apikey",
      model: "zen-tidy-tabs.model",
      urlMode: "zen-tidy-tabs.urlmode",
      labelStyle: "zen-tidy-tabs.labelstyle",
    };

    try {
      // Open the modal, change every field, and save.
      await zen.rightClickButton();
      await zen.waitForOverlay();
      await zen.fillSettings({ apiKey, model });
      await zen.selectSegment("Minimal"); // urlmode → minimal
      await zen.selectSegment("Text only"); // labelstyle → text
      await zen.clickPrimary();
      await zen.waitForNoOverlay();

      // The choices are written to about:config prefs.
      expect(await zen.readPref(prefs.apiKey)).toBe(apiKey);
      expect(await zen.readPref(prefs.model)).toBe(model);
      expect(await zen.readPref(prefs.urlMode)).toBe("minimal");
      expect(await zen.readPref(prefs.labelStyle)).toBe("text");

      // Reopening the modal reflects the saved values.
      await zen.rightClickButton();
      await zen.waitForOverlay();
      const values = await zen.settingsInputValues();
      expect(values.apiKey).toBe(apiKey);
      expect(values.model).toBe(model);
      expect(await zen.activeSegments()).toEqual(
        expect.arrayContaining(["Minimal", "Text only"]),
      );
      await zen.pressEscape();
      await zen.waitForNoOverlay();
    } finally {
      // Restore defaults so other specs in this worker keep a usable key and
      // the default url/label behavior.
      await zen.setPref(prefs.urlMode, "detailed");
      await zen.setPref(prefs.labelStyle, "filled");
      await zen.setPref(prefs.model, "");
      await zen.setPref(prefs.apiKey, "sk-or-v1-zen-tidy-tabs-test-key");
    }
  });

  // SETTINGS-3: Cancel, the ✕ button, Escape, and clicking outside the panel
  // all close the modal without persisting any changes.
  test("closing the settings modal without saving discards changes", async ({
    zen,
  }) => {
    const apiKeyPref = "zen-tidy-tabs.apikey";
    const savedKey = await zen.readPref(apiKeyPref);
    const sentinel = "sk-or-v1-should-never-persist";

    const closers: [string, () => Promise<void>][] = [
      ["Cancel button", () => zen.clickCancel()],
      ["✕ button", () => zen.clickModalClose()],
      ["Escape key", () => zen.pressEscape()],
      ["click outside", () => zen.clickOutsideModal()],
    ];

    try {
      for (const [how, close] of closers) {
        await zen.rightClickButton();
        await zen.waitForOverlay();
        await zen.fillSettings({ apiKey: sentinel });

        await close();
        await zen.waitForNoOverlay();

        expect(await zen.overlayExists(), `${how} closes the modal`).toBe(
          false,
        );
        expect(
          await zen.readPref(apiKeyPref),
          `${how} does not persist changes`,
        ).toBe(savedKey);
      }
    } finally {
      await zen.setPref(apiKeyPref, savedKey);
    }
  });

  // SETTINGS-3: focus is trapped inside the modal while it is open.
  test("focus stays trapped inside the open settings modal", async ({
    zen,
  }) => {
    try {
      await zen.rightClickButton();
      await zen.waitForOverlay();

      const trap = await zen.modalFocusTrap();
      expect(trap.forward, "Tab from the last control wraps to the first").toBe(
        true,
      );
      expect(
        trap.backward,
        "Shift+Tab from the first control wraps to the last",
      ).toBe(true);
    } finally {
      await zen.pressEscape();
      await zen.waitForNoOverlay();
    }
  });
});
