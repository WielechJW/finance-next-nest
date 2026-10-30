import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import {
  getBrowserDatabaseUrl,
  loadTestEnvironment,
} from './test/support/database.js';

loadTestEnvironment();
// Fail before building or launching anything if the test database is unsafe.
getBrowserDatabaseUrl();

export default defineConfig({
  testDir: './test/browser',
  testMatch: '**/*.pw.ts',
  workers: 1,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 10000 },
  forbidOnly: Boolean(process.env.CI),
  outputDir: './test-results',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'Backend testowy',
      command: 'npm run build:browser && node test/browser/start-backend.mjs',
      cwd: fileURLToPath(new URL('./', import.meta.url)),
      url: 'http://localhost:3101',
      timeout: 120000,
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
    },
    {
      name: 'Frontend testowy',
      command:
        'npm run build && npm run start -- --hostname localhost --port 3100',
      cwd: fileURLToPath(new URL('../frontend/', import.meta.url)),
      url: 'http://localhost:3100/login',
      timeout: 120000,
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
      env: {
        NODE_ENV: 'production',
        BROWSER_TEST_BUILD: '1',
        NEXT_PUBLIC_API_URL: 'http://localhost:3101',
      },
    },
  ],
});
