// @ts-check
const { defineConfig } = require("@playwright/test");

/**
 * The browser is driven by selenium-webdriver in *chrome context* (see
 * src/zen-driver.js), not by Playwright's own browser engine — Playwright can't
 * launch Zen or reach its chrome UI. We only use @playwright/test as the test
 * runner (fixtures, retries, reporting), so there is no `use`/`projects` browser
 * config here and no Playwright browser download is required.
 *
 * Exactly one Zen instance is launched per worker, so we pin workers to 1.
 */
module.exports = defineConfig({
  testDir: "./specs",
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Launching Zen + injecting the script + driving chrome UI is slow-ish.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
});
