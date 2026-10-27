import { describe, expect, test } from 'vitest'
import type { Place } from './location'
import { IMPORT_COLUMNS, cellToDate, duplicateKey, parseImport } from './reagentImport'

const header = IMPORT_COLUMNS.map((c) => c.header)
const places = new Map<string, Place>([['z1', { zoneId: 'z1', cabinetId: 'c1', label: '제1과학실 › A 시약장 › 진한 산' }]])
const ctx = { places, existingKeys: new Set([duplicateKey('염화 나트륨', null)]), defaultDate: '2026-03-01', today: '2026-10-27' }

/** One input row by header name; everything else blank. */
function row(values: Record<string, unknown>): unknown[] {
  return header.map((h) => values[h.replace(' *', '')] ?? null)
}

describe('IMPORT_COLUMNS', () => {
  test('columns in template order, required ones marked', () => {
    expect(IMPORT_COLUMNS.map((c) => c.header)).toEqual([
      '약품명 *', '농도(%)', '화학식', 'CAS No.', '규격', '단위 *', '기초 재고량 *', '기준일', '주용도', '유효기간', '구입일', '개봉일',
      '제조사', '구입처', '보관 위치', '독극물', '금지물질', '허가물질', '제한물질', '비고',
    ])
    expect(IMPORT_COLUMNS.find((c) => c.key === 'unit')!.choices).toEqual(['mL', 'g'])
    expect(IMPORT_COLUMNS.find((c) => c.key === 'grade')!.choices).toEqual(['시약용', '공업용'])
    expect(IMPORT_COLUMNS.find((c) => c.key === 'poison')!.choices).toEqual(['예', '아니오'])
  })
})

describe('cellToDate', () => {
  test.each([
    [new Date(Date.UTC(2026, 2, 1)), '2026-03-01'],
    [46082, '2026-03-01'],
    ['2026.3.1', '2026-03-01'],
    ['2026-03-01', '2026-03-01'],
    ['2026/03/01', '2026-03-01'],
    ['2026-02-30', null],
    ['내일', null],
  ])('%s → %s', (input, expected) => {
    expect(cellToDate(input)).toBe(expected)
  })
})

describe('parseImport', () => {
  test('a good row becomes reagent values with the hazard judged and the default start date', () => {
    const [r] = parseImport([header, row({ 약품명: '염화 수소(염산)', '농도(%)': '35%', 'CAS No.': '7647-01-0', 단위: 'mL', '기초 재고량': 500, '보관 위치': '제1과학실 › A 시약장 › 진한 산', 독극물: '예' })], ctx)
    expect(r).toMatchObject({ line: 2, status: 'ok', errors: [], initialAmount: 500, initialDate: '2026-03-01' })
    expect(r.values).toMatchObject({ name: '염화 수소(염산)', concentration: 35, casNo: '7647-01-0', unit: 'mL', zoneId: 'z1', poison: true, toxic: '해당', accidentPrep: '해당', hazardManual: false, mainUse: '실험용' })
  })

  test('the example row and empty rows are skipped silently', () => {
    const rows = parseImport([header, row({ 약품명: '예시 – 염화 수소(염산)', 단위: 'mL', '기초 재고량': 1 }), row({}), row({ 약품명: '붕산', 단위: 'g', '기초 재고량': 100, 기준일: '2026-04-01' })], ctx)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ line: 4, status: 'ok', initialDate: '2026-04-01' })
  })

  test.each([
    ['missing name', { 단위: 'mL', '기초 재고량': 1 }, '약품명'],
    ['missing unit', { 약품명: '붕산', '기초 재고량': 1 }, '단위'],
    ['unknown unit', { 약품명: '붕산', 단위: 'L', '기초 재고량': 1 }, '단위'],
    ['bad CAS', { 약품명: '붕산', 단위: 'g', '기초 재고량': 1, 'CAS No.': '10043-35-4' }, 'CAS'],
    ['unknown place', { 약품명: '붕산', 단위: 'g', '기초 재고량': 1, '보관 위치': '없는 곳' }, '보관 위치'],
    ['future date', { 약품명: '붕산', 단위: 'g', '기초 재고량': 1, 기준일: '2026-12-01' }, '기준일'],
    ['negative amount', { 약품명: '붕산', 단위: 'g', '기초 재고량': -1 }, '기초 재고량'],
    ['molar concentration', { 약품명: '염산', 단위: 'mL', '기초 재고량': 1, '농도(%)': '1M' }, '농도는 %로 입력'],
  ])('%s is an error', (_, values, reason) => {
    const [r] = parseImport([header, row(values)], ctx)
    expect(r.status).toBe('error')
    expect(r.errors.join(' ')).toContain(reason)
  })

  test('a reagent already registered is skipped, not an error', () => {
    const [r] = parseImport([header, row({ 약품명: ' 염화 나트륨 ', 단위: 'g', '기초 재고량': 1 })], ctx)
    expect(r.status).toBe('skip')
  })

  test('the same reagent twice in the file is an error on both rows', () => {
    const rows = parseImport([header, row({ 약품명: '붕산', 단위: 'g', '기초 재고량': 1 }), row({ 약품명: '붕산', 단위: 'g', '기초 재고량': 2 })], ctx)
    expect(rows.map((r) => r.status)).toEqual(['error', 'error'])
    expect(rows[1].errors.join(' ')).toContain('2번째 줄')
  })

  test('duplicateKey ignores spaces and case; a blank concentration is its own value', () => {
    expect(duplicateKey(' Ethanol ', 95)).toBe(duplicateKey('ethanol', 95))
    expect(duplicateKey('에탄올', null)).not.toBe(duplicateKey('에탄올', 100))
  })
})
