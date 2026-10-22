import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI), retries: 0, workers: 2,
  use: { baseURL: 'http://127.0.0.1:4173/kadr-video-lab/', viewport: { width: 390, height: 844 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
    trace: 'off' }, // Never capture native signed iframe URLs in traces.
  webServer: { command: 'node scripts/serve.mjs', url: 'http://127.0.0.1:4173/kadr-video-lab/', reuseExistingServer: Boolean(process.env.KADR_USE_RUNNING_SERVER) },
});
