import { beforeEach, expect, test } from 'vitest'
import { createAdmin } from './helpers.js'
import { loadGas } from './loadGas.js'

let gas

beforeEach(() => {
  gas = loadGas()
})

function fillSheet() {
  const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  gas.ctx.sheetSetSchoolInfo({ schoolName: '청주중학교', managerName: '김운영' })
  gas.call('records.create', { table: 'Rooms', values: { name: '제1과학실', isLab: true, note: '' } }, token)
  return token
}

test('needs the exact confirmation word and changes nothing otherwise', () => {
  fillSheet()
  expect(() => gas.ctx.sheetMakeTemplate('네')).toThrow('원본으로 초기화')
  expect(gas.sheet('Rooms').length).toBe(2)
  expect(gas.call('system.info').data.template).toBe(false)
})

test('empties every table and the history, keeping the headers', () => {
  fillSheet()
  gas.ctx.sheetMakeTemplate(' 원본으로 초기화 ')
  for (const name of ['Users', 'Settings', 'Rooms']) expect(gas.sheet(name).length).toBe(1)
  expect(gas.history()).toEqual([])
  expect(gas.sheet('Users')[0]).toContain('아이디')
  expect(gas.ctx.checkSheetStructure().filter((p) => p.includes('열이 없습니다'))).toEqual([])
})

test('the template itself cannot be used: web requests, first admin and school info are refused', () => {
  const token = fillSheet()
  gas.ctx.sheetMakeTemplate('원본으로 초기화')
  expect(gas.call('system.info').data).toMatchObject({ template: true, needsSetup: true, copied: false, closed: false, schoolName: '' })
  const login = gas.call('auth.login', { loginId: 'kim', password: 'first-pass-1' })
  expect(login.error.code).toBe('SHEET_TEMPLATE')
  expect(login.error.message).toContain('사본 만들기')
  expect(gas.call('records.list', { table: 'Rooms' }, token).error.code).toBe('SHEET_TEMPLATE')
  expect(() => gas.ctx.sheetCreateAdmin({ loginId: 'kim', name: '김운영', password: 'first-pass-1' })).toThrow('배포용 원본')
  expect(() => gas.ctx.sheetSetSchoolInfo({ schoolName: 'x', managerName: '' })).toThrow('배포용 원본')
})

test('a copy of the template is a fresh school sheet', () => {
  fillSheet()
  gas.ctx.sheetCloseSheet('옮김')
  gas.ctx.sheetMakeTemplate('원본으로 초기화')
  gas.fakes.setSpreadsheetId('school-B')
  expect(gas.call('system.info').data).toMatchObject({ template: false, copied: false, closed: false, needsSetup: true, schoolName: '' })
  createAdmin(gas, 'park', '박운영', 'second-pass-1')
  gas.ctx.sheetSetSchoolInfo({ schoolName: '충주고등학교', managerName: '박운영' })
  expect(gas.call('system.info').data).toMatchObject({ needsSetup: false, schoolName: '충주고등학교' })
})
