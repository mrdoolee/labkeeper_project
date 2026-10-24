// SessionStart hook: make sure gas/ and web/ have their npm packages, so
// tests, lint, build and e2e work right away — on a local PC (Windows, macOS,
// Linux) or in a cloud session. Installs only when packages are missing or
// package-lock.json changed, so a normal start costs almost nothing.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const done = []
const failed = []

for (const dir of ['gas', 'web']) {
  const cwd = path.join(root, dir)
  const lock = path.join(cwd, 'package-lock.json')
  const installed = path.join(cwd, 'node_modules', '.package-lock.json')
  if (!fs.existsSync(lock)) continue
  const fresh = fs.existsSync(installed) && fs.statSync(installed).mtimeMs >= fs.statSync(lock).mtimeMs
  if (fresh) continue
  // Playwright uses an installed Chromium (see web/playwright.config.ts); never download during install.
  const res = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd,
    shell: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
  })
  if (res.status === 0) done.push(dir)
  else failed.push(`${dir}: ${String(res.stderr || res.error || '').trim().split('\n').slice(-3).join(' ')}`)
}

if (failed.length) console.log(`LabKeeper: npm install failed (${failed.join(' | ')}). Run "npm install" in that folder by hand.`)
else if (done.length) console.log(`LabKeeper: installed packages in ${done.join(', ')}.`)
