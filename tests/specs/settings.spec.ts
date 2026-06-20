import { expect, test } from "../src/fixtures";

test.describe("Settings", () => {
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

    // Open the modal, change every field, and save. reset() restores these prefs
    // to the suite baseline before the next test, so no per-test teardown.
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

  // SETTINGS-5: the key-help link is a real, keyboard-operable control that opens
  // the keys page and dismisses the modal.
  test("the key-help link is keyboard-reachable and opens the keys page", async ({
    zen,
  }) => {
    await zen.rightClickButton();
    await zen.waitForOverlay();
    try {
      // It is a real anchor with an href, so the modal's focus trap can reach it.
      const linkState = await zen.exec(() => {
        const link = document.querySelector(".zen-tidy-tabs-link");
        if (!link) {
          return null;
        }
        const trapSelector =
          "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";
        return {
          href: link.getAttribute("href"),
          inFocusTrap: link.matches(trapSelector),
        };
      });
      expect(linkState, "the key-help link exists").not.toBeNull();
      expect(linkState?.href, "the link has a real href").toContain(
        "openrouter.ai/keys",
      );
      expect(linkState?.inFocusTrap, "the focus trap can reach the link").toBe(
        true,
      );

      // Stub the trusted-link API to record the navigation instead of opening a
      // real tab, then activate the link from the keyboard (Space).
      const opened = await zen.exec(() => {
        window.__zenTidyTabsOpenedLink = null;
        window.__zenTidyTabsOrigOpenLink = window.openTrustedLinkIn;
        window.openTrustedLinkIn = (url: string) => {
          window.__zenTidyTabsOpenedLink = url;
        };
        const link = document.querySelector<HTMLElement>(".zen-tidy-tabs-link");
        link?.focus();
        link?.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: " ",
            bubbles: true,
            cancelable: true,
          }),
        );
        return window.__zenTidyTabsOpenedLink ?? null;
      });
      expect(
        opened,
        "activating the link via the keyboard opens the keys page",
      ).toContain("openrouter.ai/keys");

      // Activating the link dismisses the settings modal.
      await zen.waitForNoOverlay();
    } finally {
      await zen.exec(() => {
        if (window.__zenTidyTabsOrigOpenLink !== undefined) {
          window.openTrustedLinkIn = window.__zenTidyTabsOrigOpenLink;
          window.__zenTidyTabsOrigOpenLink = undefined;
        }
        return true;
      });
      await zen.pressEscape();
      await zen.waitForNoOverlay();
    }
  });

  // SETTINGS-6: the privacy note below the "Tab info sent to AI" control describes
  // only the currently-selected mode and updates as the selection changes.
  test("the privacy note reflects the selected url mode", async ({ zen }) => {
    await zen.rightClickButton();
    await zen.waitForOverlay();
    try {
      expect(
        await zen.privacyNoteCount(),
        "a single privacy note is shown",
      ).toBe(1);

      await zen.selectSegment("Detailed");
      const detailed = await zen.privacyNoteText();
      expect(detailed.toLowerCase()).toContain("url");

      await zen.selectSegment("Compact");
      const compact = await zen.privacyNoteText();
      expect(compact.toLowerCase()).toContain("hostname");

      await zen.selectSegment("Minimal");
      const minimal = await zen.privacyNoteText();
      expect(minimal.toLowerCase()).toContain("only");
      expect(minimal.toLowerCase()).not.toContain("url");
      expect(minimal.toLowerCase()).not.toContain("hostname");

      expect(new Set([detailed, compact, minimal]).size).toBe(3);
      expect(await zen.privacyNoteCount()).toBe(1);
    } finally {
      await zen.pressEscape();
      await zen.waitForNoOverlay();
    }
  });
});
