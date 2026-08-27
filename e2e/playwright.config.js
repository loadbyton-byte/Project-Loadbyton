import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  webServer: [
    { command: 'npm --prefix ../server start', port: 4000, reuseExistingServer: true },
    { command: 'npm --prefix ../web run dev -- --port 5173', port: 5173, reuseExistingServer: true },
  ],
  use: { baseURL: 'http://localhost:5173', trace: 'on-first-retry' },
});
