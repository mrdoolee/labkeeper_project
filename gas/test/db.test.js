import { beforeEach, describe, expect, test } from 'vitest'
import { loadGas } from './loadGas.js'

const u = { id: 'user-1', name: '김교사' }
const u2 = { id: 'user-2', name: '이교사' }
let gas, db

beforeEach(() => {
  gas = loadGas()
  db = gas.ctx
})

function headerOf(table) {
  return gas.sheet(table)[0]
}

function cell(table, rowIndex, column) {
  const data = gas.sheet(table)
  return data[rowIndex][data[0].indexOf(column)]
}

function audit() {
  const data = gas.sheet('AuditLog')
  const head = data[0]
  return data.slice(1).map((line) => Object.fromEntries(head.map((h, i) => [h, line[i]])))
}

describe('dbCreate', () => {
  test('creates the sheet with a header row and fills the common columns', () => {
    const row = db.dbCreate('Rooms', { name: '제1과학실', isLab: true }, u)
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(row).toMatchObject({ name: '제1과학실', isLab: true, createdBy: 'user-1', updatedBy: 'user-1', deleted: false })
    expect(row.createdAt).toBe('2026-03-02T09:00:00.000Z')
    expect(headerOf('Rooms')).toEqual(
      expect.arrayContaining(['id', 'name', 'isLab', 'note', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt', 'deleted', 'deletedBy', 'deletedAt']),
    )
    expect(db.dbGet('Rooms', row.id)).toMatchObject({ name: '제1과학실', isLab: true })
    expect(audit()).toHaveLength(1)
    expect(audit()[0]).toMatchObject({ action: 'create', table: 'Rooms', recordId: row.id, userId: 'user-1', userName: '김교사' })
  })

  test('numbers and booleans come back as JS types', () => {
    const cab = db.dbCreate('Cabinets', { roomId: 'r1', name: 'A', type: 'sealed', locked: false, rows: 3, cols: 2 }, u)
    const back = db.dbGet('Cabinets', cab.id)
    expect(back.rows).toBe(3)
    expect(back.cols).toBe(2)
    expect(back.locked).toBe(false)
  })

  test.each(['=SUM(A1)', '-1번 시약장', '+82', '@home', '0123', 'TRUE'])('text %s is stored as text and read back unchanged', (name) => {
    const row = db.dbCreate('Rooms', { name }, u)
    expect(db.dbGet('Rooms', row.id).name).toBe(name)
    expect(cell('Rooms', 1, 'name')).toBe(name)
  })

  test('rejects a column the table does not have', () => {
    expect(() => db.dbCreate('Rooms', { color: 'red' }, u)).toThrow(/color/)
  })
})

describe('dbUpdate', () => {
  test('changes the row, stamps the editor and logs only what changed', () => {
    const row = db.dbCreate('Rooms', { name: '과학실', note: '1층' }, u)
    gas.fakes.advanceTime(60)
    const after = db.dbUpdate('Rooms', row.id, { name: '제2과학실' }, u2)
    expect(after).toMatchObject({ name: '제2과학실', note: '1층', updatedBy: 'user-2', createdBy: 'user-1' })
    expect(after.updatedAt).toBe('2026-03-02T09:01:00.000Z')
    const log = audit()[1]
    expect(log.action).toBe('update')
    expect(JSON.parse(log.before)).toEqual({ name: '과학실' })
    expect(JSON.parse(log.after)).toEqual({ name: '제2과학실' })
  })

  test('an unknown column is INVALID', () => {
    const row = db.dbCreate('Rooms', { name: '과학실' }, u)
    let err
    try {
      db.dbUpdate('Rooms', row.id, { colour: 'x' }, u)
    } catch (e) {
      err = e
    }
    expect(err.code).toBe('INVALID')
  })

  test('a missing id is NOT_FOUND', () => {
    db.dbCreate('Rooms', { name: '과학실' }, u)
    let err
    try {
      db.dbUpdate('Rooms', 'nope', { name: 'x' }, u)
    } catch (e) {
      err = e
    }
    expect(err.code).toBe('NOT_FOUND')
  })
})

describe('soft delete and restore', () => {
  test('a deleted row is hidden by default, kept with who deleted it, and can be restored', () => {
    const row = db.dbCreate('Rooms', { name: '준비실' }, u)
    db.dbSoftDelete('Rooms', row.id, u2)
    expect(db.dbList('Rooms')).toHaveLength(0)
    const all = db.dbList('Rooms', { includeDeleted: true })
    expect(all[0]).toMatchObject({ deleted: true, deletedBy: 'user-2' })
    expect(all[0].deletedAt).toBe('2026-03-02T09:00:00.000Z')
    db.dbRestore('Rooms', row.id, u)
    expect(db.dbList('Rooms')).toHaveLength(1)
    expect(db.dbGet('Rooms', row.id)).toMatchObject({ deleted: false, deletedBy: '', deletedAt: '' })
    expect(audit().map((a) => a.action)).toEqual(['create', 'delete', 'restore'])
  })
})

describe('dbList', () => {
  test('filters with where on typed values', () => {
    db.dbCreate('Zones', { cabinetId: 'c1', row: 1, col: 1, name: '1단 1칸' }, u)
    db.dbCreate('Zones', { cabinetId: 'c2', row: 1, col: 1, name: '1단 1칸' }, u)
    db.dbCreate('Zones', { cabinetId: 'c1', row: 2, col: 1, name: '2단 1칸' }, u)
    expect(db.dbList('Zones', { where: { cabinetId: 'c1' } }).map((z) => z.name)).toEqual(['1단 1칸', '2단 1칸'])
    expect(db.dbList('Zones', { where: { cabinetId: 'c1', row: 2 } })).toHaveLength(1)
  })

  test('still reads and writes correctly after someone reorders columns and inserts their own column', () => {
    const a = db.dbCreate('Rooms', { name: '제1과학실', isLab: true, note: 'A' }, u)
    const b = db.dbCreate('Rooms', { name: '준비실', isLab: false, note: 'B' }, u)
    const before = db.dbList('Rooms')

    const sheet = gas.fakes.sheets.get('Rooms')
    sheet.data = sheet.data.map((line, i) => {
      const reversed = line.slice().reverse()
      reversed.splice(2, 0, i === 0 ? '메모' : '손으로 쓴 메모')
      return reversed
    })

    expect(db.dbList('Rooms')).toEqual(before)
    const c = db.dbCreate('Rooms', { name: '과학실 3', isLab: true }, u)
    expect(cell('Rooms', 3, 'name')).toBe('과학실 3')
    expect(cell('Rooms', 3, '메모')).toBe('')
    expect(db.dbList('Rooms').map((r) => r.id)).toEqual([a.id, b.id, c.id])
  })

  test('adds a header that is missing from an existing sheet', () => {
    const row = db.dbCreate('Rooms', { name: '과학실' }, u)
    const sheet = gas.fakes.sheets.get('Rooms')
    const noteAt = sheet.data[0].indexOf('note')
    sheet.data = sheet.data.map((line) => line.filter((_, i) => i !== noteAt))
    db.dbUpdate('Rooms', row.id, { note: '새 메모' }, u)
    expect(headerOf('Rooms')).toContain('note')
    expect(db.dbGet('Rooms', row.id).note).toBe('새 메모')
  })
})

describe('audit of users', () => {
  test('salt and hash never reach the audit log', () => {
    const row = db.dbCreate('Users', { loginId: 'kim', name: '김', role: 'admin', salt: 'SALT-SECRET-1', hash: 'HASH-SECRET-1', mustChangePassword: false, active: true }, u)
    db.dbUpdate('Users', row.id, { hash: 'HASH-SECRET-2', name: '김교사' }, u)
    const text = JSON.stringify(gas.sheet('AuditLog'))
    expect(text).not.toContain('SALT-SECRET')
    expect(text).not.toContain('HASH-SECRET')
    expect(text).toContain('김교사')
  })
})
