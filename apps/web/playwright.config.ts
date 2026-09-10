import { defineConfig } from '@playwright/test';

/** One spec per user story's Independent Test (Constitution Principle II). */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    // This environment ships a pinned Chromium that does not match the
    // build @playwright/test would fetch, and downloading one is disallowed.
    // Point at the installed binary when it is present; fall back to
    // Playwright's own resolution elsewhere (CI, a developer's machine).
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [{ name: 'chromium', use: { channel: undefined } }],
  webServer: {
    command: 'bun run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
  },
});
