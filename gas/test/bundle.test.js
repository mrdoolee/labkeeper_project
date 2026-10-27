import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { bundleSource } from '../bundle.mjs'
import { createFakes } from './fakes.js'

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'LabKeeper.gs')

test('the school file is up to date with gas/src (run npm run bundle)', () => {
  expect(fs.readFileSync(dist, 'utf8'), 'run npm run bundle').toBe(bundleSource())
})

test('the school file runs on its own as one Apps Script file', () => {
  const ctx = vm.createContext({ ...createFakes().globals, console })
  vm.runInContext(bundleSource(), ctx)
  for (const fn of ['doPost', 'doGet', 'onOpen', 'sheetCreateAdmin', 'systemInfo']) expect(typeof ctx[fn]).toBe('function')
  expect(ctx.API_VERSION).toBe(4)
  expect(bundleSource()).toMatch(/^\/\/ LabKeeper 학교용 코드/)
})
