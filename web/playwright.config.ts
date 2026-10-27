import fs from 'node:fs'
import { defineConfig } from '@playwright/test'

// Runs the web app against the local GAS dev server (in-memory data).
// Browser: PW_CHROMIUM if set, else the cloud container's Chromium if present,
// else Playwright's own (on a PC run "npx playwright install chromium" once).
const CLOUD_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const executablePath = process.env.PW_CHROMIUM ?? (fs.existsSync(CLOUD_CHROMIUM) ? CLOUD_CHROMIUM : undefined)
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // One in-memory GAS dev server is shared, so the scenarios run one after another.
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    launchOptions: { executablePath },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1366, height: 860 },
  },
  webServer: [
    { command: 'node ../gas/dev-server.mjs', url: 'http://127.0.0.1:8787/', reuseExistingServer: false },
    {
      command: 'npx vite --host 127.0.0.1 --port 5173 --strictPort',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
    },
  ],
})
