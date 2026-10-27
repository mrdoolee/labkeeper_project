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
