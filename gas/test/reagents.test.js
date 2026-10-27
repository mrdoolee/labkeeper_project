import { beforeEach, describe, expect, test } from 'vitest'
import { createAdmin } from './helpers.js'
import { loadGas } from './loadGas.js'

// The fake clock starts at 2026-03-02 18:00 KST, so "today" is 2026-03-02.
let gas, teacherToken

beforeEach(() => {
  gas = loadGas()
  const adminToken = createAdmin(gas, 'kim', '김운영', 'first-pass-1').token
  const created = gas.call('users.create', { loginId: 'lee', name: '이교사', role: 'teacher' }, adminToken).data
  teacherToken = gas.call('auth.login', { loginId: 'lee', password: created.tempPassword }).data.token
})

function call(action, payload, token = teacherToken) {
  return gas.call(action, payload, token)
}

const HCL = { name: '염화 수소(염산)', concentration: 35, casNo: '7647-01-0', unit: 'mL', toxic: '해당', accidentPrep: '해당' }

function register(values = {}, initialAmount = 500, initialDate = '2026-03-01') {
  return call('reagents.create', { values: { ...HCL, ...values }, initialAmount, initialDate })
}

describe('reagents.create', () => {
  test('stores the reagent with its initial stock record and history', () => {
    const res = register()
    expect(res.ok).toBe(true)
    expect(res.data).toMatchObject({ name: '염화 수소(염산)', concentration: 35, unit: 'mL', stock: 500, createdByName: '이교사' })
    const txs = gas.rows('ReagentTx')
    expect(txs).toHaveLength(1)
    expect(txs[0]).toMatchObject({ kind: '기초 재고', amount: 500, date: '2026-03-01', reagentName: '염화 수소(염산)', reagentId: res.data.id })
    expect(gas.sheet('시약').length).toBe(2)
    expect(gas.sheet('시약 수불').length).toBe(2)
    expect(gas.sheet('시약 이력').length).toBe(3)
  })

  test('an initial stock of 0 is allowed', () => {
    expect(register({}, 0).data.stock).toBe(0)
  })

  test.each([
    ['missing name', { name: ' ' }],
    ['unknown unit', { unit: 'L' }],
    ['zero concentration', { concentration: 0 }],
    ['concentration over 100', { concentration: 101 }],
    ['bad CAS check digit', { casNo: '7647-01-1' }],
    ['unknown hazard status', { toxic: 'yes' }],
    ['stock written directly', { stock: 1 }],
    ['impossible date', { expiryDate: '2026-02-30' }],
    ['unknown grade', { grade: '특급' }],
  ])('%s is INVALID', (_, values) => {
    expect(register(values).error.code).toBe('INVALID')
  })

  test('a future or impossible initial date is INVALID', () => {
    expect(register({}, 500, '2026-03-03').error.code).toBe('INVALID')
    expect(register({}, 500, '2026-13-01').error.code).toBe('INVALID')
  })

  test('a negative initial amount is INVALID', () => {
    expect(register({}, -1).error.code).toBe('INVALID')
  })

  test('the zone must exist', () => {
    expect(register({ zoneId: 'nope' }).error.code).toBe('NOT_FOUND')
  })
})

describe('duplicates: same name and concentration', () => {
  test('spaces and case do not make a new reagent', () => {
    register()
    const again = register({ name: ' 염화 수소(염산) ' })
    expect(again.error.code).toBe('INVALID')
    expect(again.error.message).toContain('이미 등록')
    register({ name: 'Ethanol', concentration: 95, casNo: '', toxic: '해당 없음', accidentPrep: '해당 없음' })
    expect(register({ name: 'ethanol', concentration: 95, casNo: '', toxic: '해당 없음', accidentPrep: '해당 없음' }).error.code).toBe('INVALID')
  })

  test('spaces inside the name do not make a new reagent', () => {
    register({ name: '수산화 나트륨', concentration: 5, casNo: '1310-73-2' })
    expect(register({ name: '수산화나트륨', concentration: 5, casNo: '1310-73-2' }).error.code).toBe('INVALID')
  })

  test('another concentration, or a blank one, is a different reagent', () => {
    register()
    expect(register({ concentration: 9 }).ok).toBe(true)
    expect(register({ concentration: null }).ok).toBe(true)
    expect(register({ concentration: null }).error.code).toBe('INVALID')
  })

  test('renaming into a duplicate is INVALID', () => {
    register()
    const other = register({ concentration: 9 }).data
    expect(call('reagents.update', { id: other.id, changes: { concentration: 35 } }).error.code).toBe('INVALID')
  })

  test('restoring a deleted reagent while a live duplicate exists is INVALID', () => {
    const first = register().data
    expect(call('reagents.delete', { id: first.id }).ok).toBe(true)
    expect(register().ok).toBe(true)
    expect(call('reagents.restore', { id: first.id }).error.code).toBe('INVALID')
  })
})

describe('reagents.update / delete / list', () => {
  test('stock cannot be written', () => {
    const r = register().data
    expect(call('reagents.update', { id: r.id, changes: { stock: 1 } }).error.code).toBe('INVALID')
  })

  test('changes are saved and listed; deleted ones only on request', () => {
    const r = register().data
    expect(call('reagents.update', { id: r.id, changes: { note: '갈색병' } }).data.note).toBe('갈색병')
    call('reagents.delete', { id: r.id })
    expect(call('reagents.list', {}).data).toHaveLength(0)
    expect(call('reagents.list', { includeDeleted: true }).data).toHaveLength(1)
  })

  test('the generic records actions cannot touch the reagent tables', () => {
    expect(call('records.list', { table: 'Reagents' }).error.code).toBe('FORBIDDEN')
    expect(call('records.update', { table: 'ReagentTx', id: 'x', changes: {} }).error.code).toBe('FORBIDDEN')
  })
})

describe('reagents.createMany', () => {
  function row(line, values = {}, initialAmount = 100) {
    return { line, values: { ...HCL, ...values }, initialAmount, initialDate: '2026-03-01' }
  }

  test('one bad row stops the whole file', () => {
    const res = call('reagents.createMany', { rows: [row(2), row(3, { concentration: 9 }), row(4, { unit: 'L' })] })
    expect(res.error.code).toBe('INVALID')
    expect(res.error.message.startsWith('4번째 줄')).toBe(true)
    expect(gas.rows('Reagents')).toHaveLength(0)
  })

  test('two rows of the same reagent in the file are INVALID', () => {
    expect(call('reagents.createMany', { rows: [row(2), row(3, { name: '염화 수소(염산) ' })] }).error.code).toBe('INVALID')
  })

  test('rows that are already registered are skipped', () => {
    register()
    const res = call('reagents.createMany', { rows: [row(2, { concentration: 9 }), row(3), row(4, { concentration: 1 })] })
    expect(res.ok).toBe(true)
    expect(res.data.skippedLines).toEqual([3])
    expect(res.data.created.map((r) => r.concentration)).toEqual([9, 1])
    expect(gas.rows('ReagentTx')).toHaveLength(3)
  })
})

describe('reagentTx: in and out records', () => {
  let r
  beforeEach(() => {
    r = register().data // 500 mL on 2026-03-01
  })

  function out(amount, extra = {}) {
    return call('reagentTx.create', { reagentId: r.id, date: '2026-03-02', kind: 'out', amount, purpose: '2학년 중화 반응 실험', ...extra })
  }

  test('a use lowers the stock and is stored with who wrote it', () => {
    const res = out(50)
    expect(res.ok).toBe(true)
    expect(res.data.stock).toBe(450)
    expect(res.data.tx).toMatchObject({ kind: 'out', amount: 50, reagentId: r.id, date: '2026-03-02' })
    expect(gas.rows('ReagentTx').at(-1)).toMatchObject({ kind: '출고', reagentName: '염화 수소(염산)', createdByName: '이교사' })
    expect(call('reagents.list', {}).data[0].stock).toBe(450)
  })

  test('using more than is left is refused', () => {
    const res = out(600)
    expect(res.error.code).toBe('INVALID')
    expect(res.error.message).toBe('남은 양(500 mL)보다 많습니다.')
  })

  test('a use needs a purpose; a delivery does not, and only a delivery has a price', () => {
    expect(out(10, { purpose: ' ' }).error.code).toBe('INVALID')
    expect(call('reagentTx.create', { reagentId: r.id, date: '2026-03-02', kind: 'in', amount: 100, purpose: '', price: 25000 }).data.stock).toBe(600)
    expect(out(10, { price: 100 }).error.code).toBe('INVALID')
  })

  test('dates must be real, not in the future and not before the initial stock', () => {
    expect(out(10, { date: '2026-03-03' }).error.code).toBe('INVALID')
    expect(out(10, { date: '2026-02-28' }).error.code).toBe('INVALID')
    expect(out(10, { date: '2026-02-30' }).error.code).toBe('INVALID')
  })

  test('only in and out can be written; amounts must be positive', () => {
    expect(out(10, { kind: 'initial' }).error.code).toBe('INVALID')
    expect(out(0).error.code).toBe('INVALID')
    expect(out(-5).error.code).toBe('INVALID')
  })

  test('a back-dated record that would make a later balance negative is refused', () => {
    const small = register({ concentration: 9 }, 100).data
    call('reagentTx.create', { reagentId: small.id, date: '2026-03-02', kind: 'out', amount: 80, purpose: '실험' })
    const res = call('reagentTx.create', { reagentId: small.id, date: '2026-03-01', kind: 'out', amount: 30, purpose: '실험' })
    expect(res.error.code).toBe('INVALID')
    expect(res.error.message).toContain('2026-03-02')
  })

  test('editing, deleting and restoring a record recompute the stock', () => {
    const tx = out(80).data.tx
    expect(call('reagentTx.update', { id: tx.id, changes: { amount: 90 } }).data.stock).toBe(410)
    expect(call('reagentTx.delete', { id: tx.id }).data.stock).toBe(500)
    expect(call('reagentTx.restore', { id: tx.id }).data.stock).toBe(410)
  })

  test('an edit or restore that would go negative is refused', () => {
    const tx = out(80).data.tx
    expect(call('reagentTx.update', { id: tx.id, changes: { amount: 501 } }).error.code).toBe('INVALID')
    call('reagentTx.delete', { id: tx.id })
    out(450)
    expect(call('reagentTx.restore', { id: tx.id }).error.code).toBe('INVALID')
  })

  test('the initial stock can be corrected but not removed or turned into a use', () => {
    const initial = call('reagentTx.list', { reagentId: r.id }).data[0]
    expect(initial.kind).toBe('initial')
    expect(call('reagentTx.update', { id: initial.id, changes: { amount: 200 } }).data.stock).toBe(200)
    expect(call('reagentTx.update', { id: initial.id, changes: { kind: 'out' } }).error.code).toBe('INVALID')
    expect(call('reagentTx.delete', { id: initial.id }).error.code).toBe('INVALID')
  })

  test('the initial date cannot move after a later record', () => {
    out(10)
    const initial = call('reagentTx.list', { reagentId: r.id }).data[0]
    expect(call('reagentTx.update', { id: initial.id, changes: { date: '2026-03-02' } }).ok).toBe(true)
    const other = register({ concentration: 1 }, 10, '2026-03-01').data
    call('reagentTx.create', { reagentId: other.id, date: '2026-03-01', kind: 'out', amount: 1, purpose: '실험' })
    const init2 = call('reagentTx.list', { reagentId: other.id }).data.find((t) => t.kind === 'initial')
    expect(call('reagentTx.update', { id: init2.id, changes: { date: '2026-03-02' } }).error.code).toBe('INVALID')
  })

  test('decimal amounts add up cleanly', () => {
    const g = register({ name: '황산 구리(Ⅱ)', concentration: null, casNo: '7758-99-8', unit: 'g' }, 0).data
    call('reagentTx.create', { reagentId: g.id, date: '2026-03-02', kind: 'in', amount: 0.1, purpose: '' })
    expect(call('reagentTx.create', { reagentId: g.id, date: '2026-03-02', kind: 'in', amount: 0.2, purpose: '' }).data.stock).toBe(0.3)
  })

  test('a use makes one history entry; the stock update is not logged separately', () => {
    const before = gas.sheet('시약 이력').length
    out(10)
    expect(gas.sheet('시약 이력').length).toBe(before + 1)
  })

  test('the reagent history includes its records', () => {
    out(10)
    const entries = call('audit.list', { table: 'Reagents', recordId: r.id }).data
    expect(entries.map((e) => [e.table, e.action])).toEqual([
      ['ReagentTx', 'create'],
      ['ReagentTx', 'create'],
      ['Reagents', 'create'],
    ])
  })

  test('the reagent history also shows edits and deletes of its records', () => {
    const tx = out(10).data.tx
    call('reagentTx.update', { id: tx.id, changes: { amount: 20 } })
    call('reagentTx.delete', { id: tx.id })
    const entries = call('audit.list', { table: 'Reagents', recordId: r.id }).data
    expect(entries.slice(0, 2).map((e) => [e.table, e.action])).toEqual([
      ['ReagentTx', 'delete'],
      ['ReagentTx', 'update'],
    ])
  })

  test('records of a deleted reagent cannot be added', () => {
    call('reagents.delete', { id: r.id })
    expect(out(10).error.code).toBe('NOT_FOUND')
  })

  test('list by date range across reagents, deleted records only on request', () => {
    const other = register({ concentration: 9 }, 100).data
    const tx = out(10).data.tx
    call('reagentTx.delete', { id: tx.id })
    expect(call('reagentTx.list', { from: '2026-03-01', to: '2026-03-01' }).data).toHaveLength(2)
    expect(call('reagentTx.list', { reagentId: r.id }).data).toHaveLength(1)
    expect(call('reagentTx.list', { reagentId: r.id, includeDeleted: true }).data).toHaveLength(2)
    expect(other.id).toBeTruthy()
  })

  test('recent purposes: unique, newest first, at most 8', () => {
    for (let i = 1; i <= 10; i++) out(1, { purpose: `실험 ${i}` })
    out(1, { purpose: '실험 3' })
    const recent = call('reagentTx.recentPurposes', {}).data
    expect(recent).toEqual(['실험 3', '실험 10', '실험 9', '실험 8', '실험 7', '실험 6', '실험 5', '실험 4'])
  })
})

describe('places that hold reagents cannot be deleted', () => {
  let roomId, cabinetId, zones
  beforeEach(() => {
    roomId = call('records.create', { table: 'Rooms', values: { name: '제1과학실', isLab: true } }).data.id
    cabinetId = call('records.create', { table: 'Cabinets', values: { roomId, name: 'A 시약장', type: 'sealed', locked: true, rows: 1, cols: 2 } }).data.id
    zones = call('records.createMany', { table: 'Zones', rows: [{ cabinetId, row: 1, col: 1 }, { cabinetId, row: 1, col: 2 }] }).data
    register({ zoneId: zones[0].id })
  })

  function expectBlocked(res) {
    expect(res.error.code).toBe('INVALID')
    expect(res.error.message).toContain('염화 수소(염산) 35%')
    expect(res.error.message).toContain('먼저 시약의 보관 위치를 옮겨 주세요')
  }

  test('the zone, the cabinet and the room are protected', () => {
    expectBlocked(call('records.delete', { table: 'Zones', id: zones[0].id }))
    expectBlocked(call('records.deleteMany', { table: 'Zones', ids: [zones[1].id, zones[0].id] }))
    expectBlocked(call('records.delete', { table: 'Cabinets', id: cabinetId }))
    expectBlocked(call('records.delete', { table: 'Rooms', id: roomId }))
    expect(gas.rows('Zones').every((z) => z.deleted === false)).toBe(true)
  })

  test('an empty zone can still be deleted, and so can a place whose reagent was deleted', () => {
    expect(call('records.delete', { table: 'Zones', id: zones[1].id }).ok).toBe(true)
    const r = call('reagents.list', {}).data[0]
    call('reagents.delete', { id: r.id })
    expect(call('records.delete', { table: 'Rooms', id: roomId }).ok).toBe(true)
  })
})
