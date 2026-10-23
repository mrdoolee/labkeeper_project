import { describe, expect, test } from 'vitest'
import { CABINET_TYPES, STORAGE_CLASSES, copyZones, planZones, type ZoneRow } from './storage'

const SEALED_DEFAULT = 'inorganic_acid,organic_acid,base,reactive_inorganic,metal'

function grid(cabinetId: string, rows: number, cols: number): ZoneRow[] {
  const out: ZoneRow[] = []
  for (let row = 1; row <= rows; row++)
    for (let col = 1; col <= cols; col++)
      out.push({ id: `z${row}${col}`, cabinetId, row, col, name: `${row}단 ${col}칸`, allowedClasses: SEALED_DEFAULT })
  return out
}

describe('storage data', () => {
  test('there are the 8 storage classes from the design, in shelf order', () => {
    expect(STORAGE_CLASSES.map((c) => c.id)).toEqual([
      'inorganic_acid',
      'organic_acid',
      'base',
      'reactive_inorganic',
      'metal',
      'flammable',
      'general_inorganic',
      'general_organic',
    ])
    expect(STORAGE_CLASSES[3].label).toBe('위험이 높은 무기화합물(산화제 포함)')
  })

  test('cabinet types and their default classes', () => {
    expect(CABINET_TYPES.map((t) => t.id)).toEqual(['sealed', 'flammable', 'general', 'waste', 'equipment', 'fridge'])
    const defaults = Object.fromEntries(CABINET_TYPES.map((t) => [t.id, t.defaultClasses.join(',')]))
    expect(defaults).toEqual({
      sealed: SEALED_DEFAULT,
      flammable: 'flammable',
      general: 'general_inorganic,general_organic',
      waste: '',
      equipment: '',
      fridge: '',
    })
  })
})

describe('planZones', () => {
  test('a new 3×2 sealed cabinet gets 6 zones named by shelf and slot', () => {
    const plan = planZones({ id: 'c1', type: 'sealed', rows: 3, cols: 2 }, [])
    expect(plan.remove).toEqual([])
    expect(plan.create).toHaveLength(6)
    expect(plan.create[0]).toEqual({ cabinetId: 'c1', row: 1, col: 1, name: '1단 1칸', allowedClasses: SEALED_DEFAULT })
    expect(plan.create.map((z) => z.name)).toContain('3단 2칸')
  })

  test('shrinking 3×2 to 2×2 removes the third shelf only', () => {
    const plan = planZones({ id: 'c1', type: 'sealed', rows: 2, cols: 2 }, grid('c1', 3, 2))
    expect(plan.create).toEqual([])
    expect(plan.remove.sort()).toEqual(['z31', 'z32'])
  })

  test('growing 2×2 to 2×3 adds the new slots and keeps renamed zones untouched', () => {
    const existing = grid('c1', 2, 2)
    existing[0].name = '산 칸'
    const plan = planZones({ id: 'c1', type: 'sealed', rows: 2, cols: 3 }, existing)
    expect(plan.remove).toEqual([])
    expect(plan.create.map((z) => z.name)).toEqual(['1단 3칸', '2단 3칸'])
  })

  test('deleted zones do not count as existing', () => {
    const existing = grid('c1', 1, 1).map((z) => ({ ...z, deleted: true }))
    const plan = planZones({ id: 'c1', type: 'general', rows: 1, cols: 1 }, existing)
    expect(plan.create).toEqual([{ cabinetId: 'c1', row: 1, col: 1, name: '1단 1칸', allowedClasses: 'general_inorganic,general_organic' }])
    expect(plan.remove).toEqual([])
  })
})

describe('copyZones', () => {
  test('copies names, classes and positions to the new cabinet without ids', () => {
    const source = grid('c1', 1, 3)
    source[0].name = '진한 산'
    source[1].allowedClasses = 'base'
    source[2].deleted = true
    const copy = copyZones(source, 'c2')
    expect(copy).toEqual([
      { cabinetId: 'c2', row: 1, col: 1, name: '진한 산', allowedClasses: SEALED_DEFAULT },
      { cabinetId: 'c2', row: 1, col: 2, name: '1단 2칸', allowedClasses: 'base' },
    ])
  })
})
