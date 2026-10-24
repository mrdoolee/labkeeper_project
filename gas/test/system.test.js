import { beforeEach, expect, test } from 'vitest'
import { createAdmin } from './helpers.js'
import { loadGas } from './loadGas.js'

let gas

beforeEach(() => {
  gas = loadGas()
})

test('reports version, setup need and school name on an empty sheet', () => {
  expect(gas.call('system.info').data).toEqual({ name: 'LabKeeper', apiVersion: 3, needsSetup: true, copied: false, closed: false, closedNote: '', schoolName: '', managerName: '' })
})

test('after an admin and a school name exist', () => {
  createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  gas.ctx.sheetSetSchoolInfo({ schoolName: '청주중학교', managerName: '' })
  expect(gas.call('system.info').data).toMatchObject({ needsSetup: false, schoolName: '청주중학교' })
})

test('a copy of a blank template adopts the new sheet', () => {
  gas.call('system.info')
  gas.fakes.setSpreadsheetId('sheet-B')
  expect(gas.call('system.info').data.copied).toBe(false)
  expect(gas.fakes.properties.get('OWNER_SPREADSHEET_ID')).toBe('sheet-B')
})

test('a copy of a sheet in use is flagged and refuses other requests', () => {
  const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  gas.fakes.setSpreadsheetId('sheet-B')
  expect(gas.call('system.info').data.copied).toBe(true)
  const login = gas.call('auth.login', { loginId: 'kim', password: 'first-pass-1' })
  expect(login.error.code).toBe('SHEET_COPIED')
  expect(login.error.message).toContain('사본을 새 학교 시트로 시작')
  expect(gas.call('records.list', { table: 'Rooms' }, token).error.code).toBe('SHEET_COPIED')
})

test('a sheet used before this feature (no owner yet, has users) is adopted, not flagged', () => {
  createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  gas.fakes.properties.clear()
  expect(gas.call('system.info').data.copied).toBe(false)
  expect(gas.fakes.properties.get('OWNER_SPREADSHEET_ID')).toBe('sheet-A')
})

test('the web setup actions are gone', () => {
  expect(gas.call('setup.createAdmin', { loginId: 'xxx', name: 'x', password: 'xxxxxxxx' }).error.code).toBe('UNKNOWN_ACTION')
  expect(gas.call('setup.status').error.code).toBe('UNKNOWN_ACTION')
})

test('a copied template whose Users sheet does not exist yet is not a copy in use', () => {
  gas.fakes.properties.set('OWNER_SPREADSHEET_ID', 'sheet-template')
  expect(gas.fakes.sheets.has('Users')).toBe(false)
  expect(gas.call('system.info').data).toMatchObject({ copied: false, needsSetup: true })
})
