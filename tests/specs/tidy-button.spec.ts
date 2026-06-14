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

  // CONTROL-6: the twin must not carry Zen's
  // `zen-workspace-close-unpinned-tabs-button` class, otherwise Zen's own
  // first-match querySelector targets our twin and the real Clear control loses
  // its icon. (Reproduction of the bug where mounting Tidy hid Clear's icon.)
  test("the tidy twin does not steal Clear's control class", async ({
    zen,
  }) => {
    // Open eligible unpinned tabs so Zen renders + maintains its Clear control.
    await zen.openTabs(3);
    await zen.waitForButton();

    const report = await zen.clearTwinReport();
    if (!report.hasClear) {
      // No Clear control in this build/state — the class-hijack cannot occur.
      console.warn(
        "Clear control not present — skipping the control-class hijack check.",
      );
      return;
    }

    expect(
      report.tidyHasClearClass,
      "the Tidy twin must not carry Zen's clear-control class",
    ).toBe(false);
    expect(
      report.firstMatchIsTidy,
      "Zen's first-match lookup must resolve to the real Clear, not the twin",
    ).toBe(false);
  });
});
