// Loads every gas/src/*.js file into one shared context, the way Apps Script
// runs a project's files, with fake Google services as globals.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { createFakes } from './fakes.js'

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')

export function loadGas(options = {}) {
  const fakes = createFakes(options)
  const logs = []
  const quietConsole = { log: (...a) => logs.push(a), error: (...a) => logs.push(a), warn: (...a) => logs.push(a) }
  const ctx = vm.createContext({ ...fakes.globals, console: quietConsole })
  for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith('.js')).sort()) {
    vm.runInContext(fs.readFileSync(path.join(srcDir, file), 'utf8'), ctx, { filename: file })
  }
  function post(contents) {
    return JSON.parse(ctx.doPost({ postData: { contents } }).getContent())
  }
  return {
    ctx,
    fakes,
    logs,
    post,
    call(action, payload, token) {
      return post(JSON.stringify({ action, token, payload }))
    },
    sheet(name) {
      const s = fakes.sheets.get(name)
      return s ? s.data.map((line) => line.slice()) : null
    },
  }
}
