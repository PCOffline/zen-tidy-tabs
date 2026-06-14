import { expect, test } from "../src/fixtures";

// LABEL-1: with labelstyle=text the group badges render Arc-style (transparent
// background, neutral-weight text); with labelstyle=filled (default) they keep
// Zen's native coloured style. Changing the setting re-applies immediately.
const LABEL_STYLE = "zen-tidy-tabs.labelstyle";
// Distinctive declaration that only the text-only stylesheet emits.
const TEXT_MARKER = "font-weight: 700 !important";

test.describe("Group appearance", () => {
  test.beforeEach(async ({ zen }) => {
    await zen.reset();
  });

  test("text labelstyle renders an Arc-style text-only badge", async ({
    zen,
  }) => {
    await zen.createGroup("Looks", "blue", 2);
    try {
      // text: the stylesheet emits the text-only block and the badge renders
      // with a transparent background and neutral weight.
      await zen.setPref(LABEL_STYLE, "text");
      await zen.injectStyles();
      expect(
        await zen.injectedStyleText(),
        "text mode injects the text-only badge rule",
      ).toContain(TEXT_MARKER);
      expect(
        await zen.groupLabelComputed("background-color"),
        "the text badge has a transparent background",
      ).toBe("rgba(0, 0, 0, 0)");
      expect(
        await zen.groupLabelComputed("font-weight"),
        "the text badge uses the neutral weight",
      ).toBe("700");

      // filled: the text-only block is gone, so Zen's native style applies.
      await zen.setPref(LABEL_STYLE, "filled");
      await zen.injectStyles();
      expect(
        await zen.injectedStyleText(),
        "filled mode drops the text-only badge rule",
      ).not.toContain(TEXT_MARKER);
    } finally {
      await zen.setPref(LABEL_STYLE, "filled");
      await zen.injectStyles();
    }
  });
});
