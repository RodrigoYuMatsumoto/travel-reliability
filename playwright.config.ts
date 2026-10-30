import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4310', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm start',
    env: {
      APP_MODE: 'demo',
      HOST: '127.0.0.1',
      PORT: '4310',
      PUBLIC_URL: 'http://127.0.0.1:4310',
      LLM_ENABLED: 'false',
      ALLOW_DEMO_EXTERNAL_STORES: 'false',
    },
    url: 'http://127.0.0.1:4310/health',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
