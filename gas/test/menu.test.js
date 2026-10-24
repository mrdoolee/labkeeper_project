import { beforeEach, expect, test } from 'vitest'
import { createAdmin } from './helpers.js'
import { loadGas } from './loadGas.js'

let gas

beforeEach(() => {
  gas = loadGas()
})

function teacherToken(adminToken) {
  const { tempPassword } = gas.call('users.create', { loginId: 'lee', name: '이교사', role: 'teacher' }, adminToken).data
  return gas.call('auth.login', { loginId: 'lee', password: tempPassword }).data.token
}

test('creates the first admin once, recorded as 첫 설정', () => {
  expect(gas.ctx.sheetCreateAdmin({ loginId: 'Kim', name: '김운영', password: 'first-pass-1' })).toEqual({ loginId: 'kim', name: '김운영' })
  const login = gas.call('auth.login', { loginId: 'kim', password: 'first-pass-1' })
  expect(login.data.user.role).toBe('admin')
  expect(() => gas.ctx.sheetCreateAdmin({ loginId: 'park', name: '박', password: 'first-pass-1' })).toThrow('이미 운영 교사 계정이 있습니다')
  expect(gas.call('system.info').data.needsSetup).toBe(false)
  const created = gas.call('audit.list', { table: 'Users' }, login.data.token).data.find((e) => e.action === 'create')
  expect(created.userName).toBe('첫 설정')
})

test('rejects a bad login id, a missing name or a short password', () => {
  expect(() => gas.ctx.sheetCreateAdmin({ loginId: 'k', name: '김', password: 'first-pass-1' })).toThrow('아이디는')
  expect(() => gas.ctx.sheetCreateAdmin({ loginId: 'kim', name: ' ', password: 'first-pass-1' })).toThrow('이름을 입력')
  expect(() => gas.ctx.sheetCreateAdmin({ loginId: 'kim', name: '김', password: 'short' })).toThrow('8자 이상')
  expect(gas.call('system.info').data.needsSetup).toBe(true)
})

test('resets an admin password from the sheet, ending their sessions', () => {
  const { token, user } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  const { tempPassword } = gas.ctx.sheetResetAdminPassword(' Kim ')
  expect(tempPassword).toMatch(/^[a-z0-9]{10}$/)
  expect(gas.call('auth.me', {}, token).error.code).toBe('AUTH_REQUIRED')
  expect(gas.call('auth.login', { loginId: 'kim', password: 'first-pass-1' }).ok).toBe(false)
  const login = gas.call('auth.login', { loginId: 'kim', password: tempPassword })
  expect(login.data.user.mustChangePassword).toBe(true)
  const reset = gas.call('audit.list', { table: 'Users', recordId: user.id }, login.data.token).data.find((e) => e.action === 'passwordReset')
  expect(reset.userName).toBe('시트 소유자')
})

test('a reset also clears a lockout', () => {
  createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  for (let i = 0; i < 5; i++) gas.call('auth.login', { loginId: 'kim', password: 'wrong-pass' })
  expect(gas.call('auth.login', { loginId: 'kim', password: 'first-pass-1' }).error.code).toBe('LOCKED_OUT')
  const { tempPassword } = gas.ctx.sheetResetAdminPassword('kim')
  expect(gas.call('auth.login', { loginId: 'kim', password: tempPassword }).ok).toBe(true)
})

test('refuses to reset a teacher or an unknown id', () => {
  const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  teacherToken(token)
  expect(() => gas.ctx.sheetResetAdminPassword('lee')).toThrow('운영 교사 계정을 찾을 수 없습니다')
  expect(() => gas.ctx.sheetResetAdminPassword('nobody')).toThrow('운영 교사 계정을 찾을 수 없습니다')
})

test('start fresh clears every data row and un-flags the copy', () => {
  const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  gas.call('records.create', { table: 'Rooms', values: { name: '제1과학실', isLab: true, note: '' } }, token)
  gas.call('settings.update', { schoolName: '청주중학교' }, token)
  gas.fakes.setSpreadsheetId('sheet-B')
  expect(gas.call('system.info').data.copied).toBe(true)
  expect(gas.ctx.sheetStartFresh()).toBe(true)
  expect(gas.call('system.info').data).toEqual({ name: 'LabKeeper', apiVersion: 3, needsSetup: true, copied: false, closed: false, closedNote: '', schoolName: '', managerName: '' })
  for (const name of ['Users', 'Settings', 'Rooms']) expect(gas.sheet(name).length).toBe(1)
  expect(gas.sheet('Rooms')[0]).toContain('name')
  // the history keeps one line saying the sheet was started fresh
  const log = gas.sheet('AuditLog')
  expect(log.length).toBe(2)
  expect(log[1]).toContain('startFresh')
  expect(log[1]).toContain('시트 소유자')
})

test('structure check is empty for a healthy sheet and lists a renamed header or missing sheet', () => {
  createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  expect(gas.ctx.checkSheetStructure()).toContain('Rooms 시트가 없습니다')
  const users = gas.fakes.sheets.get('Users')
  users.data[0][users.data[0].indexOf('loginId')] = 'loginid'
  expect(gas.ctx.checkSheetStructure()).toContain('Users 시트에 loginId 열이 없습니다')
  // checking must not repair anything by itself
  expect(users.data[0]).not.toContain('loginId')
})

test('only an admin gets the sheet address', () => {
  const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  expect(gas.call('system.sheetUrl', {}, token).data).toEqual({ url: 'https://docs.google.com/spreadsheets/d/sheet-A/edit' })
  expect(gas.call('system.sheetUrl', {}, teacherToken(token)).error.code).toBe('FORBIDDEN')
  expect(gas.call('system.sheetUrl').error.code).toBe('AUTH_REQUIRED')
})

test('the directory names the sheet owner', () => {
  const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  expect(gas.call('directory.list', {}, token).data).toContainEqual({ id: 'sheet-owner', name: '시트 소유자' })
})

test('start fresh refuses on the original sheet, so a live school cannot be wiped by mistake', () => {
  const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  gas.call('records.create', { table: 'Rooms', values: { name: '제1과학실', isLab: true, note: '' } }, token)
  expect(() => gas.ctx.sheetStartFresh()).toThrow('운영 중인 시트의 사본에서만')
  expect(gas.sheet('Rooms').length).toBe(2)
  expect(gas.call('auth.me', {}, token).ok).toBe(true)
})
