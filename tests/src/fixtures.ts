import { test as base, expect } from "@playwright/test";
import { ZenDriver } from "./zen-driver";

/**
 * Worker-scoped fixture: launch one Zen instance per worker, inject the
 * userscript, and tear it down at the end. Specs receive it as the `zen`
 * fixture. Tests within a worker run serially; an autouse `resetState` fixture
 * resets to a clean, hermetic state before each test.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: `void` is the idiomatic fixture-value type for a Playwright autouse fixture that provides nothing.
export const test = base.extend<{ resetState: void }, { zen: ZenDriver }>({
  zen: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright detects fixture dependencies from this destructuring pattern; this fixture has none.
    async ({}, use) => {
      const zen = await ZenDriver.launch();
      await use(zen);
      await zen.quit();
    },
    { scope: "worker" },
  ],

  // Autouse: reset to a clean, hermetic state before every test (clears tabs,
  // groups, the modal, the four prefs, and notifications). Replaces the
  // per-spec `beforeEach(() => zen.reset())` boilerplate.
  resetState: [
    async ({ zen }, use) => {
      await zen.reset();
      await use();
    },
    { auto: true },
  ],
});

export { expect };
