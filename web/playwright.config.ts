import { defineConfig } from '@playwright/test'

// Runs the web app against the local GAS dev server (in-memory data).
// Uses the Chromium already installed in this environment; nothing is downloaded.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    launchOptions: { executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1366, height: 860 },
  },
  webServer: [
    { command: 'node ../gas/dev-server.mjs', url: 'http://127.0.0.1:8787/', reuseExistingServer: false },
    {
      command: 'npx vite --host 127.0.0.1 --port 5173 --strictPort',
      url: 'http://127.0.0.1:5173',
      env: { VITE_GAS_URL: 'http://127.0.0.1:8787/' },
      reuseExistingServer: false,
    },
  ],
})
