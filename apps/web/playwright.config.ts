import { defineConfig } from '@playwright/test';

/** One spec per user story's Independent Test (Constitution Principle II). */
export default defineConfig({
  testDir: './tests/e2e',
  // One worker, deliberately. A deployment has exactly one workspace row —
  // its ceilings, its concurrency cap, its credentials — and seven of these
  // eight specs configure it. Run in parallel, a spec asserting on a ceiling
  // or a queue position is reading whatever another spec set a moment ago,
  // which is a test of nothing. Serial execution is what makes those
  // assertions about the product rather than about the scheduler.
  workers: 1,
  fullyParallel: false,
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
