import { expect, test } from "../src/fixtures";

test.describe("Tidy button", () => {
  test.beforeEach(async ({ zen }) => {
    await zen.reset();
  });

  test("the tidy button exists", async ({ zen }) => {
    await zen.waitForButton();
    expect(await zen.buttonExists()).toBe(true);
  });

  test("the tidy button's placement is correct", async ({ zen }) => {
    await zen.waitForButton();
    const p = await zen.getButtonPlacement();

    expect(p.exists).toBe(true);

    if (p.hasClear) {
      // Intended placement: a twin sitting in Clear's parent, immediately
      // before the Clear control (see control.placeTwinIfClearPresent()).
      expect(p.isTwin, "button should be a twin of Clear").toBe(true);
      expect(p.sameParentAsClear, "button shares Clear's parent").toBe(true);
      expect(
        p.immediatelyBeforeClear,
        "button sits immediately before Clear",
      ).toBe(true);
    } else {
      // No Clear control in this build/state: the script mounts a hover-reveal
      // fallback inside the active workspace tab section instead.
      console.warn(
        "Clear control not present — verifying the separator-fallback placement.",
      );
      expect(
        p.inActiveSection,
        "fallback control lives in the active workspace section",
      ).toBe(true);
    }
  });
});
