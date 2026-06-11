import { test } from "../src/fixtures";

/**
 * Manual inspection session. Launches a real, headed Zen with the userscript
 * injected, seeds some tabs and a sample group, then keeps the window open so
 * you can interact with it by hand. Run it with `npm run inspect`.
 *
 * The OpenRouter call is stubbed by default so clicking Tidy deterministically
 * produces groups without a key/network. To exercise the real LLM flow instead,
 * set ZEN_TIDY_API_KEY to your OpenRouter key before running.
 */
test("[manual] open Zen for inspection", async ({ zen }) => {
  test.setTimeout(0); // never time out; the session lives until you Ctrl+C

  await zen.reset();
  await zen.openTabs(5, "Inspect ");
  await zen.createGroup("Sample Group", "blue", 2);

  const realKey = process.env.ZEN_TIDY_API_KEY;
  if (realKey) {
    await zen.exec(
      (key: string, value: string) => {
        Services.prefs.setStringPref(key, value);
        return true;
      },
      "zen-tidy-tabs.apikey",
      realKey,
    );
  } else {
    // Canned grouping so the Tidy button actually sorts tabs into groups.
    await zen.installFetchStub({
      groups: [
        { name: "Research", tabs: [0, 1, 2] },
        { name: "Reading", tabs: [3, 4] },
      ],
    });
  }

  console.log(
    [
      "",
      "========================================================",
      " Zen is open with Zen Tidy Tabs loaded.",
      "   • Hover the tab strip to reveal the 🧹 Tidy button",
      "   • Right-click the Tidy button to open Settings",
      "   • Click the Tidy button to group the open tabs",
      "        " +
        (realKey
          ? "(using your real OpenRouter key)"
          : "(LLM stubbed → expect 'Research' + 'Reading' groups)"),
      "   • Single-click a group badge to rename it inline",
      "   • Double-click a group badge to rename + recolor it",
      "",
      " Press Ctrl+C in this terminal when you're done.",
      "========================================================",
      "",
    ].join("\n"),
  );

  // Park here so the window stays open. Ctrl+C ends the session.
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
});
