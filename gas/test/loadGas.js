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
    // Raw cells of a tab, by the tab's real (Korean) name or a table key.
    sheet(name) {
      const s = fakes.sheets.get(name) || fakes.sheets.get(ctx.SHEET_NAMES?.[name])
      return s ? s.data.map((line) => line.slice()) : null
    },
    // Rows of a data table as objects keyed by column key (e.g. createdByName).
    rows(table) {
      const data = this.sheet(table)
      if (!data) return []
      const keys = data[0].map((label) => ctx.keyForLabel(table, String(label)))
      return data.slice(1).map((line) => Object.fromEntries(keys.map((k, i) => [k ?? `?${i}`, line[i]])))
    },
    // Every history line from all 이력 tabs, oldest first, keyed by column key.
    history() {
      const out = []
      for (const name of Object.values(ctx.HISTORY_TABS)) {
        const data = this.sheet(name)
        if (!data) continue
        const keys = data[0].map((label) => ctx.historyKeyForLabel(String(label)))
        data.slice(1).forEach((line) => out.push(Object.fromEntries(keys.map((k, i) => [k ?? `?${i}`, line[i]]))))
      }
      return out.map((r, i) => [r, i]).sort((a, b) => Date.parse(a[0].at) - Date.parse(b[0].at) || a[1] - b[1]).map(([r]) => r)
    },
  }
}
