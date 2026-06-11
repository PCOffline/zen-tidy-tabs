import { test as base, expect } from "@playwright/test";
import { ZenDriver } from "./zen-driver";

/**
 * Worker-scoped fixture: launch one Zen instance per worker, inject the
 * userscript, and tear it down at the end. Specs receive it as the `zen`
 * fixture. Tests within a worker run serially and call `zen.reset()` in
 * `beforeEach` to isolate state.
 */
export const test = base.extend<Record<never, never>, { zen: ZenDriver }>({
  zen: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright detects fixture dependencies from this destructuring pattern; this fixture has none.
    async ({}, use) => {
      const zen = await ZenDriver.launch();
      await use(zen);
      await zen.quit();
    },
    { scope: "worker" },
  ],
});

export { expect };
