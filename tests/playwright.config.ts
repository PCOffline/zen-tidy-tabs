import { defineConfig } from "@playwright/test";

/**
 * The browser is driven by selenium-webdriver in *chrome context* (see
 * src/zen-driver.ts), not by Playwright's own browser engine — Playwright can't
 * launch Zen or reach its chrome UI. We only use @playwright/test as the test
 * runner (fixtures, retries, reporting), so there is no `use`/`projects` browser
 * config here and no Playwright browser download is required.
 *
 * One Zen instance is launched per worker (the worker-scoped `zen` fixture), so
 * the worker count equals the number of concurrent Zen windows. Locally we use
 * two; in CI we drop to one, because several headed Zen windows under a single
 * virtual display tend to contend and flake.
 */
export default defineConfig({
  testDir: "./specs",
  workers: process.env.CI ? 1 : 2,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Launching Zen + injecting the script + driving chrome UI is slow-ish.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
});
