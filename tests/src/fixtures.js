// @ts-check
const base = require("@playwright/test");
const { ZenDriver } = require("./zen-driver");

/**
 * @typedef {import("./zen-driver").ZenDriver} ZenDriverType
 *
 * Worker-scoped fixture: launch one Zen instance per worker (workers are pinned
 * to 1 in playwright.config.js), inject the userscript, and tear it down at the
 * end. Specs receive it as the `zen` fixture.
 *
 * @type {import("@playwright/test").TestType<
 *   import("@playwright/test").PlaywrightTestArgs & { zen: ZenDriverType },
 *   import("@playwright/test").PlaywrightWorkerArgs & { zen: ZenDriverType }
 * >}
 */
const test = base.test.extend({
  zen: [
    async ({}, use) => {
      const zen = await ZenDriver.launch();
      await use(zen);
      await zen.quit();
    },
    { scope: "worker" },
  ],
});

module.exports = { test, expect: base.expect };
