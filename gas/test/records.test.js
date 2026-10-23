import { beforeEach, describe, expect, test } from 'vitest'
import { loadGas } from './loadGas.js'

let gas, adminToken, teacherToken

beforeEach(() => {
  gas = loadGas()
  adminToken = gas.call('setup.createAdmin', { loginId: 'kim', name: '김운영', password: 'first-pass-1' }).data.token
  const created = gas.call('users.create', { loginId: 'lee', name: '이교사', role: 'teacher' }, adminToken).data
  teacherToken = gas.call('auth.login', { loginId: 'lee', password: created.tempPassword }).data.token
})

function call(action, payload, token = teacherToken) {
  return gas.call(action, payload, token)
}

function room(name = '제1과학실') {
  return call('records.create', { table: 'Rooms', values: { name, isLab: true } }).data
}

function cabinet(roomId, extra = {}) {
  return call('records.create', { table: 'Cabinets', values: { roomId, name: 'A 시약장', type: 'sealed', locked: true, rows: 3, cols: 2, ...extra } })
}

describe('allowed tables', () => {
  test.each(['Users', 'AuditLog', 'Settings', 'toString', 'Nope'])('%s is FORBIDDEN', (table) => {
    expect(call('records.list', { table }).error.code).toBe('FORBIDDEN')
    expect(call('records.create', { table, values: { name: 'x' } }).error.code).toBe('FORBIDDEN')
  })

  test('the id lists match the web app', () => {
    expect([...gas.ctx.CABINET_TYPE_IDS]).toEqual(['sealed', 'flammable', 'general', 'waste', 'equipment', 'fridge'])
    expect([...gas.ctx.STORAGE_CLASS_IDS]).toEqual([
      'inorganic_acid',
      'organic_acid',
      'base',
      'reactive_inorganic',
      'metal',
      'flammable',
      'general_inorganic',
      'general_organic',
    ])
  })
})

describe('validation', () => {
  test('a column outside the table is INVALID', () => {
    expect(call('records.create', { table: 'Rooms', values: { name: 'x', createdBy: 'me' } }).error.code).toBe('INVALID')
  })

  test('a room needs a name', () => {
    expect(call('records.create', { table: 'Rooms', values: { name: '  ' } }).error.code).toBe('INVALID')
  })

  test('a cabinet needs an existing room', () => {
    expect(cabinet('no-such-room').error.code).toBe('NOT_FOUND')
  })

  test.each([{ type: 'bookshelf' }, { rows: 0 }, { cols: 21 }, { rows: 2.5 }, { locked: 'yes' }])('cabinet %j is INVALID', (extra) => {
    expect(cabinet(room().id, extra).error.code).toBe('INVALID')
  })

  test('the same checks apply on update', () => {
    const c = cabinet(room().id).data
    expect(call('records.update', { table: 'Cabinets', id: c.id, changes: { rows: 99 } }).error.code).toBe('INVALID')
    expect(call('records.update', { table: 'Cabinets', id: c.id, changes: { roomId: 'gone' } }).error.code).toBe('NOT_FOUND')
    expect(call('records.update', { table: 'Cabinets', id: c.id, changes: { rows: 4 } }).data.rows).toBe(4)
  })

  test('zones need an existing cabinet and known storage classes', () => {
    const c = cabinet(room().id).data
    const zone = (values) => call('records.create', { table: 'Zones', values: { cabinetId: c.id, row: 1, col: 1, name: '1단 1칸', ...values } })
    expect(zone({ cabinetId: 'gone' }).error.code).toBe('NOT_FOUND')
    expect(zone({ allowedClasses: 'base,poison' }).error.code).toBe('INVALID')
    expect(zone({ allowedClasses: 'inorganic_acid,base' }).data.allowedClasses).toBe('inorganic_acid,base')
    expect(zone({ col: 2, allowedClasses: '' }).ok).toBe(true)
  })
})

describe('everyday use by a teacher', () => {
  test('create, rename, delete and restore a room, each stamped with the teacher', () => {
    const r = room('과학실')
    expect(r.createdBy).toBe(call('auth.me').data.id)
    expect(call('records.update', { table: 'Rooms', id: r.id, changes: { name: '제2과학실' } }).data.name).toBe('제2과학실')
    expect(call('records.delete', { table: 'Rooms', id: r.id }).data.deleted).toBe(true)
    expect(call('records.list', { table: 'Rooms' }).data).toHaveLength(0)
    expect(call('records.list', { table: 'Rooms', includeDeleted: true }).data).toHaveLength(1)
    expect(call('records.restore', { table: 'Rooms', id: r.id }).data.deleted).toBe(false)
  })

  test('audit.list returns a record history newest first, with parsed before/after', () => {
    const r = room('과학실')
    gas.fakes.advanceTime(1)
    call('records.update', { table: 'Rooms', id: r.id, changes: { name: '제2과학실' } })
    gas.fakes.advanceTime(1)
    call('records.delete', { table: 'Rooms', id: r.id })
    const history = call('audit.list', { table: 'Rooms', recordId: r.id }).data
    expect(history.map((h) => h.action)).toEqual(['delete', 'update', 'create'])
    expect(history[1]).toMatchObject({ userName: '이교사', before: { name: '과학실' }, after: { name: '제2과학실' } })
  })

  test('audit.list honours limit', () => {
    for (let i = 0; i < 5; i++) room('방' + i)
    expect(call('audit.list', { table: 'Rooms', limit: 3 }).data).toHaveLength(3)
  })
})

describe('many rooms and cabinets', () => {
  test('records.list with where returns only one cabinet’s zones among 600', () => {
    const r = room()
    let target
    for (let i = 0; i < 30; i++) {
      const c = cabinet(r.id, { name: '시약장 ' + i, rows: 4, cols: 5 }).data
      if (i === 17) target = c
      const rows = []
      for (let row = 1; row <= 4; row++) for (let col = 1; col <= 5; col++) rows.push({ cabinetId: c.id, row, col, name: `${row}단 ${col}칸` })
      expect(call('records.createMany', { table: 'Zones', rows }).data).toHaveLength(20)
    }
    const zones = call('records.list', { table: 'Zones', where: { cabinetId: target.id } }).data
    expect(zones).toHaveLength(20)
    expect(zones.every((z) => z.cabinetId === target.id)).toBe(true)
  })

  test('createMany of a 20×20 cabinet takes one lock and a handful of sheet writes', () => {
    const c = cabinet(room().id, { rows: 20, cols: 20 }).data
    const rows = []
    for (let row = 1; row <= 20; row++) for (let col = 1; col <= 20; col++) rows.push({ cabinetId: c.id, row, col, name: `${row}단 ${col}칸` })
    const locksBefore = gas.fakes.lockCalls.wait
    const zoneWritesBefore = gas.fakes.sheets.get('Zones')?.writeCalls ?? 0
    const auditWritesBefore = gas.fakes.sheets.get('AuditLog').writeCalls
    const res = call('records.createMany', { table: 'Zones', rows })
    expect(res.data).toHaveLength(400)
    expect(gas.fakes.lockCalls.wait - locksBefore).toBe(1)
    expect(gas.fakes.sheets.get('Zones').writeCalls - zoneWritesBefore).toBeLessThanOrEqual(3)
    expect(gas.fakes.sheets.get('AuditLog').writeCalls - auditWritesBefore).toBeLessThanOrEqual(2)
    expect(call('audit.list', { table: 'Zones', limit: 500 }).data.filter((a) => a.action === 'create')).toHaveLength(400)
  })

  test('createMany validates every row before writing any', () => {
    const c = cabinet(room().id).data
    const res = call('records.createMany', {
      table: 'Zones',
      rows: [
        { cabinetId: c.id, row: 1, col: 1, name: 'ok' },
        { cabinetId: c.id, row: 1, col: 2, name: 'bad', allowedClasses: 'poison' },
      ],
    })
    expect(res.error.code).toBe('INVALID')
    expect(call('records.list', { table: 'Zones' }).data).toHaveLength(0)
  })
})

describe('one zone per slot', () => {
  function zoneRows(cabinetId, rows, cols) {
    const out = []
    for (let row = 1; row <= rows; row++) for (let col = 1; col <= cols; col++) out.push({ cabinetId, row, col, name: `${row}단 ${col}칸` })
    return out
  }

  test('a second createMany for the same slots (double click) is refused and adds nothing', () => {
    const c = cabinet(room().id).data
    expect(call('records.createMany', { table: 'Zones', rows: zoneRows(c.id, 3, 2) }).ok).toBe(true)
    const again = call('records.createMany', { table: 'Zones', rows: [{ cabinetId: c.id, row: 3, col: 2, name: 'dup' }] })
    expect(again.error.code).toBe('INVALID')
    expect(call('records.list', { table: 'Zones', where: { cabinetId: c.id } }).data).toHaveLength(6)
  })

  test('duplicates inside one batch are refused', () => {
    const c = cabinet(room().id).data
    const res = call('records.createMany', {
      table: 'Zones',
      rows: [
        { cabinetId: c.id, row: 1, col: 1, name: 'a' },
        { cabinetId: c.id, row: 1, col: 1, name: 'b' },
      ],
    })
    expect(res.error.code).toBe('INVALID')
  })

  test('a slot whose zone was deleted can be used again, but the old zone cannot then be restored on top of it', () => {
    const c = cabinet(room().id).data
    const [old] = call('records.createMany', { table: 'Zones', rows: [{ cabinetId: c.id, row: 1, col: 1, name: 'old' }] }).data
    call('records.delete', { table: 'Zones', id: old.id })
    expect(call('records.create', { table: 'Zones', values: { cabinetId: c.id, row: 1, col: 1, name: 'new' } }).ok).toBe(true)
    expect(call('records.restore', { table: 'Zones', id: old.id }).error.code).toBe('INVALID')
  })
})

describe('records.deleteMany', () => {
  test('soft-deletes several rows under one lock and logs each', () => {
    const r = room()
    const ids = [room('a').id, room('b').id, room('c').id]
    const locksBefore = gas.fakes.lockCalls.wait
    const res = call('records.deleteMany', { table: 'Rooms', ids })
    expect(res.data).toHaveLength(3)
    expect(gas.fakes.lockCalls.wait - locksBefore).toBe(1)
    expect(call('records.list', { table: 'Rooms' }).data.map((x) => x.id)).toEqual([r.id])
    expect(call('audit.list', { table: 'Rooms', limit: 3 }).data.map((a) => a.action)).toEqual(['delete', 'delete', 'delete'])
  })

  test('is limited to record tables', () => {
    expect(call('records.deleteMany', { table: 'Users', ids: ['x'] }).error.code).toBe('FORBIDDEN')
  })
})
