import { defineConfig, devices } from '@playwright/test';

/**
 * Real-browser E2E: the journeys run against the PRODUCTION build served by `vite preview`,
 * not the dev server. API routes are mocked per test for determinism; a separate opt-in
 * live-AI smoke test exists for when a real key is configured (never in CI).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
