import { defineConfig } from "@playwright/test";

/**
 * Standalone config for the manual inspection session (`npm run inspect`).
 * Kept separate from playwright.config.ts so this long-lived, headed session is
 * never picked up by the normal suite or CI.
 *
 * See manual/inspect.spec.ts. The browser is driven by selenium-webdriver in
 * chrome context, exactly like the real tests.
 */
export default defineConfig({
  testDir: "./manual",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 0, // the session stays open until you Ctrl+C
  reporter: [["list"]],
});
