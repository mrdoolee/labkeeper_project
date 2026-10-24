// How the spreadsheet looks to a person opening it: Korean tab names and
// headers, names next to ids, history split by area with readable columns.
import { beforeEach, describe, expect, test } from 'vitest'
import { createAdmin } from './helpers.js'
import { loadGas } from './loadGas.js'

let gas

beforeEach(() => {
  gas = loadGas()
})

function room(token, name = '제1과학실') {
  return gas.call('records.create', { table: 'Rooms', values: { name, isLab: true, note: '' } }, token).data
}

describe('data tabs', () => {
  test('have Korean names and headers, readable columns first and ids on the right', () => {
    const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
    room(token)
    const header = gas.sheet('교실')[0]
    expect(header.slice(0, 3)).toEqual(['이름', '과학실 여부', '메모'])
    expect(header).toEqual(expect.arrayContaining(['작성자', '작성일시', '수정자', '수정일시', '삭제됨', '삭제자', '삭제일시', 'ID', '작성자 ID']))
    expect(header.indexOf('ID')).toBeGreaterThan(header.indexOf('삭제일시'))
    expect(gas.fakes.sheets.has('Rooms')).toBe(false)
    expect(gas.sheet('계정')[0]).toEqual(expect.arrayContaining(['아이디', '이름', '역할', '사용 여부']))
  })

  test('a cabinet keeps its room id on the right, labelled', () => {
    const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
    const r = room(token)
    const cab = gas.call('records.create', { table: 'Cabinets', values: { roomId: r.id, name: 'A 시약장', type: 'sealed', locked: true, rows: 2, cols: 2, note: '' } }, token).data
    gas.call('records.create', { table: 'Zones', values: { cabinetId: cab.id, row: 1, col: 1, name: '1단 1칸', allowedClasses: '' } }, token)
    const header = gas.sheet('보관장')[0]
    expect(header[0]).toBe('이름')
    expect(header.indexOf('교실 ID')).toBeGreaterThan(header.indexOf('삭제일시'))
    expect(gas.sheet('보관장 구역')[0]).toEqual(expect.arrayContaining(['단', '칸', '이름', '허용 보관 분류', '보관장 ID']))
  })

  test('write the names of who made, changed and deleted a row, and Korean time', () => {
    const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
    const r = room(token)
    gas.call('records.delete', { table: 'Rooms', id: r.id }, token)
    const [row] = gas.rows('Rooms')
    expect(row).toMatchObject({ createdByName: '김운영', updatedByName: '김운영', deletedByName: '김운영', deleted: true })
    expect(row.createdAt).toBe('2026-03-02T18:00:00+09:00')
  })

  test('settings rows carry a readable 항목 name', () => {
    const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
    gas.call('settings.update', { region: 'seoul' }, token)
    expect(gas.rows('Settings').find((r) => r.key === 'region')).toMatchObject({ label: '장부 양식 지역', value: 'seoul' })
  })

  test('tabs are frozen on the header, blue for data and grey for history, data first', () => {
    const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
    room(token)
    gas.call('settings.update', { region: 'seoul' }, token)
    const tabs = gas.fakes.tabOrder()
    const firstHistory = tabs.findIndex((t) => t.endsWith('이력') || t === '접속 기록')
    expect(tabs.slice(firstHistory).every((t) => t.endsWith('이력') || t === '접속 기록')).toBe(true)
    expect(tabs).toContain('환경설정')
    expect(gas.fakes.sheets.get('교실').frozenRows).toBe(1)
    expect(gas.fakes.sheets.get('교실').tabColor).toBe('#2563eb')
    expect(gas.fakes.sheets.get('교실 이력').tabColor).toBe('#94a3b8')
  })

  test('a column a teacher added by hand is left alone', () => {
    const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
    room(token)
    const sheet = gas.fakes.sheets.get('교실')
    const col = sheet.data[0].length + 1
    sheet.set(1, col, '내 메모')
    sheet.set(2, col, '창가 쪽')
    room(token, '제2과학실')
    expect(gas.sheet('교실')[1][col - 1]).toBe('창가 쪽')
    expect(gas.call('records.list', { table: 'Rooms' }, token).data.map((r) => r.name)).toEqual(['제1과학실', '제2과학실'])
  })
})

describe('history tabs', () => {
  test('are split by area', () => {
    const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
    room(token)
    gas.call('settings.update', { region: 'seoul' }, token)
    gas.call('users.create', { loginId: 'lee', name: '이교사', role: 'teacher' }, token)
    expect(gas.sheet('교실 이력').length).toBe(2)
    expect(gas.sheet('환경설정 이력').length).toBe(2)
    expect(gas.sheet('계정 이력').length).toBe(3) // first admin + 이교사
    expect(gas.sheet('접속 기록').length).toBe(2) // the helper's login
    expect(gas.sheet('AuditLog')).toBeNull()
  })

  test('read like a sentence on the left and keep the raw data, greyed, on the right', () => {
    const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
    const r = room(token)
    gas.call('records.update', { table: 'Rooms', id: r.id, changes: { name: '물리실', isLab: false } }, token)
    const sheet = gas.sheet('교실 이력')
    expect(sheet[0].slice(0, 6)).toEqual(['일시', '사람', '표', '대상', '동작', '바뀐 내용'])
    expect(sheet[1].slice(0, 6)).toEqual(['2026-03-02 18:00', '김운영', '교실', '제1과학실', '추가', '이름: 제1과학실, 과학실 여부: 예'])
    expect(sheet[2].slice(0, 6)).toEqual(['2026-03-02 18:00', '김운영', '교실', '물리실', '수정', '이름: 제1과학실 → 물리실, 과학실 여부: 예 → 아니요'])
    const raw = sheet[0].indexOf('새 값(원자료)')
    expect(raw).toBeGreaterThan(5)
    expect(gas.fakes.sheets.get('교실 이력').backgrounds[`1,${raw + 1}`]).toBe('#e2e8f0')
  })

  test('settings history names the setting; secrets never appear', () => {
    const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
    gas.call('settings.update', { region: 'seoul' }, token)
    const last = gas.sheet('환경설정 이력').at(-1)
    expect(last.slice(2, 6)).toEqual(['환경설정', '장부 양식 지역', '수정', '장부 양식 지역: chungbuk → seoul'])
    expect(JSON.stringify(gas.sheet('계정 이력'))).not.toMatch(/"salt"|"hash"/)
  })

  test('audit.list still answers per record, and account history includes logins', () => {
    const { token, user } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
    const r = room(token)
    expect(gas.call('audit.list', { table: 'Rooms', recordId: r.id }, token).data).toMatchObject([{ action: 'create', userName: '김운영', after: { name: '제1과학실' } }])
    gas.fakes.advanceTime(60)
    gas.call('auth.login', { loginId: 'kim', password: 'first-pass-1' })
    const mine = gas.call('audit.list', { table: 'Users', recordId: user.id }, token).data.map((e) => e.action)
    expect(mine).toEqual(['login', 'login', 'create'])
  })
})

describe('emptying tables with a frozen header', () => {
  test('works even when the sheet has no spare rows', () => {
    const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
    room(token)
    const sheet = gas.fakes.sheets.get('교실')
    sheet.maxRows = sheet.data.length // no spare rows, as after appends past 1000
    gas.ctx.clearAllRows()
    expect(gas.sheet('교실').length).toBe(1)
  })
})

describe('moving a sheet that still has the old English layout', () => {
  function legacySheet(name, header, rows) {
    const s = gas.fakes.globals.SpreadsheetApp.getActive().insertSheet(name)
    ;[header, ...rows].forEach((line, r) => line.forEach((v, c) => s.set(r + 1, c + 1, v)))
  }

  test('renames tabs, converts headers, fills names and moves AuditLog into the history tabs', () => {
    const salt = 'aa11'
    const hash = gas.ctx.hashPassword('first-pass-1', salt)
    const common = ['createdBy', 'createdAt', 'updatedBy', 'updatedAt', 'deleted', 'deletedBy', 'deletedAt']
    legacySheet('Users', ['id', 'loginId', 'name', 'role', 'salt', 'hash', 'mustChangePassword', 'active', ...common], [
      ['u1', "'kim", "'김운영", "'admin", `'${salt}`, `'${hash}`, false, true, "'system", "'2026-03-01T00:00:00.000Z", "'system", "'2026-03-01T00:00:00.000Z", false, '', ''],
    ])
    legacySheet('Rooms', ['id', 'name', 'isLab', 'note', ...common], [
      ['r1', "'제1과학실", true, '', "'u1", "'2026-03-01T01:00:00.000Z", "'u1", "'2026-03-01T01:00:00.000Z", false, '', ''],
    ])
    legacySheet('AuditLog', ['id', 'at', 'userId', 'userName', 'table', 'recordId', 'action', 'before', 'after'], [
      ['a1', "'2026-03-01T00:00:00.000Z", "'system", "'첫 설정", "'Users", "'u1", "'create", '', `'{"loginId":"kim","name":"김운영"}`],
      ['a2', "'2026-03-01T01:00:00.000Z", "'u1", "'김운영", "'Rooms", "'r1", "'create", '', `'{"name":"제1과학실","isLab":true}`],
      ['a3', "'2026-03-01T02:00:00.000Z", "'u1", "'김운영", "'Users", "'u1", "'login", '', ''],
    ])

    const login = gas.call('auth.login', { loginId: 'kim', password: 'first-pass-1' })
    expect(login.ok).toBe(true)
    expect(gas.fakes.sheets.has('Users')).toBe(false)
    expect(gas.fakes.sheets.has('Rooms')).toBe(false)
    expect(gas.fakes.sheets.has('AuditLog')).toBe(false)
    expect(gas.rows('Rooms')).toMatchObject([{ id: 'r1', name: '제1과학실', createdByName: '김운영' }])
    expect(gas.rows('Users')[0]).toMatchObject({ loginId: 'kim', createdByName: '첫 설정' })
    expect(gas.sheet('교실 이력')[1].slice(1, 5)).toEqual(['김운영', '교실', '제1과학실', '추가'])
    expect(gas.sheet('접속 기록').length).toBe(3) // a3 + the login just now
    expect(gas.call('records.list', { table: 'Rooms' }, login.data.token).data.map((r) => r.name)).toEqual(['제1과학실'])
  })

  test('a broken line in the old AuditLog does not stop the move', () => {
    legacySheet('AuditLog', ['id', 'at', 'userId', 'userName', 'table', 'recordId', 'action', 'before', 'after'], [
      ['a1', "'2026-03-01T01:00:00.000Z", "'u1", "'김운영", "'Rooms", "'r1", "'update", "'{broken", "'{\"name\":\"물리실\"}"],
    ])
    expect(gas.call('system.info').ok).toBe(true)
    expect(gas.fakes.sheets.has('AuditLog')).toBe(false)
    const line = gas.sheet('교실 이력')[1]
    expect(line.slice(1, 5)).toEqual(['김운영', '교실', '물리실', '수정'])
  })
})
