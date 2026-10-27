// Sends the current code to the dev sheet's Apps Script and redeploys its web app
// as a new version (the web app address stays the same):
//   npm run deploy
// Needs `clasp login` and gas/.clasp.json (kept on this PC only, see docs/project-status.md).
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const run = (cmd) => execSync(cmd, { cwd: here, stdio: 'inherit' })

const config = JSON.parse(fs.readFileSync(new URL('.clasp.json', import.meta.url), 'utf8'))
if (!config.deploymentId) throw new Error('gas/.clasp.json has no deploymentId')

const sha = execSync('git rev-parse --short HEAD', { cwd: here }).toString().trim()
const dirty = execSync('git status --porcelain -- src dist', { cwd: here }).toString().trim() ? '+changes' : ''

run('node bundle.mjs')
run('npm test')
run('clasp push -f')
run(`clasp create-deployment -i ${config.deploymentId} -d "git ${sha}${dirty}"`)
