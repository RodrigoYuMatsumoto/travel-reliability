import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.PLAYWRIGHT_TEST_PORT ?? 4310);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('INVALID_PLAYWRIGHT_TEST_PORT');
const origin = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: origin, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm start',
    env: {
      APP_MODE: 'demo',
      HOST: '127.0.0.1',
      PORT: String(port),
      PUBLIC_URL: origin,
      LLM_ENABLED: 'false',
      ALLOW_DEMO_EXTERNAL_STORES: 'false',
    },
    url: origin + '/health',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
