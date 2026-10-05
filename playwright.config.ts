import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', testMatch: '*.spec.ts', fullyParallel: false, workers: 1,
  timeout: 45_000, expect: { timeout: 10_000 },
  use: { baseURL: 'http://127.0.0.1:4318', viewport: { width: 1500, height: 950 }, channel: process.env.PLAYWRIGHT_CHANNEL, trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --port 4318 --strictPort', url: 'http://127.0.0.1:4318/tests/browser/harness.html', reuseExistingServer: !process.env.CI },
});
