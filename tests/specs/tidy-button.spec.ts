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
    // Open eligible unpinned tabs so Zen renders + maintains its Clear control,
    // exercising the intended twin-placement path (CONTROL-2) rather than only
    // the separator fallback.
    await zen.openTabs(3);
    await zen.waitForButton();
    const p = await zen.getButtonPlacement();

    expect(p.exists).toBe(true);
    // Only builds/states that genuinely render no Clear control are skipped
    // (reported as skipped, never silently passed).
    test.skip(
      !p.hasClear,
      "no Clear control in this build/state — twin placement cannot be checked",
    );

    // Intended placement: a twin sitting in Clear's parent, immediately before
    // the Clear control (see control.placeTwinIfClearPresent()).
    expect(p.isTwin, "button should be a twin of Clear").toBe(true);
    expect(p.sameParentAsClear, "button shares Clear's parent").toBe(true);
    expect(
      p.immediatelyBeforeClear,
      "button sits immediately before Clear",
    ).toBe(true);
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
    // No Clear control in this build/state means the class-hijack cannot occur;
    // report as skipped rather than passing without asserting anything.
    test.skip(
      !report.hasClear,
      "no Clear control in this build/state — the control-class hijack cannot occur",
    );

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
