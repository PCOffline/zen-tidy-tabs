import { expect, test } from "../src/fixtures";

// TIDY-11: eligible tabs are collected from the active workspace only. A tab that
// belongs to another workspace is never collected, even if otherwise eligible.
// An untagged tab (no zen-workspace-id) belongs to the active workspace and stays
// eligible — collect() must not require a tag.
test.describe("Workspace-scoped collection", () => {
  test("collects only the active workspace's tabs", async ({ zen }) => {
    test.skip(
      !(await zen.workspacesAvailable()),
      "Zen workspace API unavailable in this build — TIDY-11 cannot be exercised",
    );

    await zen.openTabs(3, "Home ");
    const homeCount = await zen.collectCount();
    expect(
      homeCount,
      "the home workspace has eligible tabs",
    ).toBeGreaterThanOrEqual(3);

    // Open an otherwise-eligible tab and tag it for a *different* workspace, then
    // read collection — all in one chrome call so Zen can't re-tag it back to the
    // active workspace between tagging and the check.
    const foreign = await zen.exec((foreignId: string) => {
      const principal = Services.scriptSecurityManager.getSystemPrincipal();
      const url = "data:text/html,<title>Foreign</title>";
      const tab =
        typeof gBrowser.addTrustedTab === "function"
          ? gBrowser.addTrustedTab(url)
          : gBrowser.addTab(url, { triggeringPrincipal: principal });
      tab.setAttribute("zen-workspace-id", foreignId);
      const collected = window.zenTidyTabs.collect(true);
      return {
        total: gBrowser.tabs.length,
        count: collected.length,
        tags: collected.map((t) => t.getAttribute("zen-workspace-id")),
      };
    }, "tidy11-foreign-workspace");

    expect(foreign.total, "the foreign tab really was opened").toBeGreaterThan(
      homeCount,
    );
    expect(
      foreign.count,
      "a tab tagged for another workspace is not collected",
    ).toBe(homeCount);
    expect(
      foreign.tags,
      "no collected tab belongs to the foreign workspace",
    ).not.toContain("tidy11-foreign-workspace");

    // An untagged tab (no zen-workspace-id) belongs to the active workspace and
    // stays eligible — the guard must not require a tag.
    const untagged = await zen.exec(() => {
      const before = window.zenTidyTabs.collect(true);
      const [tab] = before;
      if (!tab) {
        return null;
      }
      tab.removeAttribute("zen-workspace-id");
      const after = window.zenTidyTabs.collect(true);
      return {
        count: after.length,
        tags: after.map((t) => t.getAttribute("zen-workspace-id")),
      };
    });
    expect(untagged, "there was a collected tab to untag").not.toBeNull();
    expect(untagged?.tags, "an untagged tab is still collected").toContain(
      null,
    );
    expect(
      untagged?.count,
      "untagging a tab does not drop it from collection",
    ).toBe(homeCount);
  });
});
