import { beforeEach, expect, test } from 'vitest'
import { createAdmin } from './helpers.js'
import { loadGas } from './loadGas.js'

let gas

beforeEach(() => {
  gas = loadGas()
})

function auditRows() {
  const rows = gas.sheet('AuditLog')
  const head = rows[0]
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])))
}

// ---- school info (entered from the sheet menu, shown in the web app) ----

test('school info entered from the sheet is shown by system.info and settings.get', () => {
  const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  gas.ctx.sheetSetSchoolInfo({ schoolName: ' 청주중학교 ', managerName: '김운영' })
  expect(gas.call('system.info').data).toMatchObject({ schoolName: '청주중학교', managerName: '김운영' })
  expect(gas.call('settings.get', {}, token).data).toMatchObject({ schoolName: '청주중학교', managerName: '김운영' })
})

test('each change is written to the AuditLog sheet with the Google account that made it', () => {
  createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  gas.fakes.setActiveUserEmail('teacher@example.com')
  gas.ctx.sheetSetSchoolInfo({ schoolName: '청주중학교', managerName: '김운영' })
  gas.ctx.sheetSetSchoolInfo({ schoolName: '청주중학교', managerName: '이교사' })
  const changes = auditRows().filter((r) => r.table === 'Settings')
  expect(changes.map((r) => r.recordId)).toEqual(['schoolName', 'managerName', 'managerName'])
  expect(changes[2].userName).toBe('시트 소유자 (teacher@example.com)')
  expect(JSON.parse(changes[2].before)).toEqual({ managerName: '김운영' })
  expect(JSON.parse(changes[2].after)).toEqual({ managerName: '이교사' })
  // the Settings rows themselves keep who changed them last
  const settings = gas.sheet('Settings')
  expect(settings[0]).toContain('updatedBy')
})

test('without a visible email the history says 시트 소유자', () => {
  gas.ctx.sheetSetSchoolInfo({ schoolName: '청주중학교', managerName: '' })
  expect(auditRows().find((r) => r.recordId === 'schoolName').userName).toBe('시트 소유자')
})

test('too long a value is refused', () => {
  expect(() => gas.ctx.sheetSetSchoolInfo({ schoolName: 'x'.repeat(101), managerName: '' })).toThrow('설정 값이 올바르지 않습니다')
})

test('the web cannot change school name or manager (the sheet is the source)', () => {
  const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  for (const key of ['schoolName', 'managerName']) {
    const res = gas.call('settings.update', { [key]: '바꾼 값' }, token)
    expect(res.error.code).toBe('INVALID')
    expect(res.error.message).toContain('시트 메뉴')
  }
  expect(gas.call('settings.update', { region: 'seoul' }, token).ok).toBe(true)
})

// ---- closing a sheet (운영 종료) ----

test('a closed sheet refuses everything but system.info, and can be reopened', () => {
  const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  gas.ctx.sheetCloseSheet('새 시트로 옮겼습니다. 운영 교사에게 새 접속 링크를 받으세요.')
  expect(gas.call('system.info').data).toMatchObject({ closed: true, closedNote: '새 시트로 옮겼습니다. 운영 교사에게 새 접속 링크를 받으세요.' })
  expect(gas.call('auth.login', { loginId: 'kim', password: 'first-pass-1' }).error.code).toBe('SHEET_CLOSED')
  expect(gas.call('records.list', { table: 'Rooms' }, token).error.code).toBe('SHEET_CLOSED')
  expect(() => gas.ctx.sheetCloseSheet('')).toThrow('이미 운영이 종료된 시트')
  gas.ctx.sheetReopenSheet()
  expect(gas.call('system.info').data).toMatchObject({ closed: false, closedNote: '' })
  expect(gas.call('records.list', { table: 'Rooms' }, token).ok).toBe(true)
  expect(() => gas.ctx.sheetReopenSheet()).toThrow('운영 중인 시트')
  expect(auditRows().map((r) => r.action)).toEqual(expect.arrayContaining(['close', 'reopen']))
})

// ---- continuing a copy (이 사본을 계속 쓰기) ----

test('continuing a copy keeps every record and account, and drops the closed mark it inherited', () => {
  const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  gas.call('records.create', { table: 'Rooms', values: { name: '제1과학실', isLab: true, note: '' } }, token)
  gas.ctx.sheetCloseSheet('옮김')                // the original is closed first
  gas.fakes.setSpreadsheetId('sheet-B')           // then copied
  expect(gas.call('system.info').data.copied).toBe(true)
  expect(gas.ctx.sheetCopySummary()).toEqual({ schoolName: '', users: 1 })
  gas.ctx.sheetContinueCopy()
  expect(gas.call('system.info').data).toMatchObject({ copied: false, closed: false, needsSetup: false })
  const login = gas.call('auth.login', { loginId: 'kim', password: 'first-pass-1' })
  expect(login.ok).toBe(true)
  expect(gas.call('records.list', { table: 'Rooms' }, login.data.token).data.map((r) => r.name)).toEqual(['제1과학실'])
  const entry = auditRows().find((r) => r.action === 'continueCopy')
  expect(JSON.parse(entry.before)).toEqual({ ownerSpreadsheetId: 'sheet-A' })
  expect(JSON.parse(entry.after)).toEqual({ ownerSpreadsheetId: 'sheet-B' })
})

test('continuing is refused on a sheet that is not a copy', () => {
  createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  expect(() => gas.ctx.sheetContinueCopy()).toThrow('사본이 아닙니다')
})

test('start fresh on a copy also drops an inherited closed mark', () => {
  createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  gas.ctx.sheetCloseSheet('옮김')
  gas.fakes.setSpreadsheetId('sheet-B')
  gas.ctx.sheetStartFresh()
  expect(gas.call('system.info').data).toMatchObject({ closed: false, copied: false, needsSetup: true })
})
