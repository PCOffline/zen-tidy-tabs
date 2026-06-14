import { expect, test } from "../src/fixtures";

// CONTROL-7: the Tidy control follows the active workspace. The bug was that it
// only ever appeared in the first workspace; switching workspaces left it
// missing. These tests create a second workspace, switch to it, and assert the
// single Tidy control is present in whichever workspace is active.
test.describe("Tidy control across workspaces", () => {
  test.beforeEach(async ({ zen }) => {
    await zen.reset();
  });

  test("the tidy control follows the active workspace", async ({ zen }) => {
    if (!(await zen.workspacesAvailable())) {
      console.warn(
        "Zen workspace API unavailable in this build — skipping CONTROL-7.",
      );
      return;
    }

    // Some content so the sidebar (and any Clear control) renders normally.
    await zen.openTabs(3);
    await zen.waitForButton();
    await zen.waitForButtonInActiveWorkspace();

    const original = await zen.activeWorkspaceId();
    let created: string | null = null;
    try {
      // Creating a workspace auto-switches to it.
      created = await zen.createWorkspace("Tidy Tabs Test Space");
      expect(
        await zen.activeWorkspaceId(),
        "creating a workspace switches to it",
      ).toBe(created);

      // The control must (re)appear in the newly active workspace.
      await zen.waitForButtonInActiveWorkspace();
      expect(
        await zen.buttonInActiveWorkspace(),
        "Tidy control is present in the second workspace",
      ).toBe(true);

      // Switching back must also keep it present in the original workspace.
      await zen.switchWorkspace(original);
      expect(
        await zen.activeWorkspaceId(),
        "switched back to the original workspace",
      ).toBe(original);
      await zen.waitForButtonInActiveWorkspace();
      expect(
        await zen.buttonInActiveWorkspace(),
        "Tidy control is present again in the original workspace",
      ).toBe(true);
    } finally {
      if (created) {
        if ((await zen.activeWorkspaceId()) !== original) {
          await zen.switchWorkspace(original);
        }
        await zen.removeWorkspace(created);
      }
    }
  });
});
