import { describe, expect, test } from 'vitest'
import { HAZARD_THRESHOLDS } from '../data/hazardThresholds'
import { isHazardous, isValidCas, judgeHazard, needsCheck } from './hazard'

describe('hazard table (Gyeonggi appendix 9)', () => {
  test('has the 46 numbered rows, each with a valid CAS No.', () => {
    expect(HAZARD_THRESHOLDS).toHaveLength(46)
    expect(HAZARD_THRESHOLDS.map((r) => r.no)).toEqual(Array.from({ length: 46 }, (_, i) => i + 1))
    for (const row of HAZARD_THRESHOLDS) expect(isValidCas(row.cas), `${row.no} ${row.name} ${row.cas}`).toBe(true)
  })

  test('the two source errors are corrected', () => {
    expect(HAZARD_THRESHOLDS[13]).toMatchObject({ no: 14, name: '시안화 칼륨', cas: '151-50-8' })
    expect(HAZARD_THRESHOLDS[17]).toMatchObject({ no: 18, name: '에탄올', formula: 'C2H5OH' })
  })
})

describe('isValidCas', () => {
  test.each([
    ['7647-01-0', true],
    ['7647-01-1', false],
    ['97-1-90', false],
    ['abc', false],
    ['', false],
  ])('%s → %s', (cas, expected) => {
    expect(isValidCas(cas)).toBe(expected)
  })
})

describe('judgeHazard', () => {
  test('hydrochloric acid: toxic and accident thresholds are both 10%', () => {
    expect(judgeHazard('7647-01-0', 9.9)).toEqual({ toxic: '해당 없음', accidentPrep: '해당 없음' })
    expect(judgeHazard('7647-01-0', 10)).toEqual({ toxic: '해당', accidentPrep: '해당' })
    expect(judgeHazard('7647-01-0', null)).toEqual({ toxic: '해당', accidentPrep: '해당' })
  })

  test('potassium permanganate at 50% is toxic but not an accident-prep substance (98%)', () => {
    expect(judgeHazard('7722-64-7', 50)).toEqual({ toxic: '해당', accidentPrep: '해당 없음' })
  })

  test('ethanol has no thresholds', () => {
    expect(judgeHazard('64-17-5', 95)).toEqual({ toxic: '해당 없음', accidentPrep: '해당 없음' })
  })

  test('a CAS No. outside the table, or none, cannot be judged', () => {
    expect(judgeHazard('50-00-0', 37)).toEqual({ toxic: '판정 불가', accidentPrep: '판정 불가' })
    expect(judgeHazard('', 37)).toEqual({ toxic: '판정 불가', accidentPrep: '판정 불가' })
  })
})

describe('isHazardous / needsCheck', () => {
  test.each([
    ['해당', '해당 없음', true, false],
    ['해당 없음', '해당', true, false],
    ['해당 없음', '해당 없음', false, false],
    ['판정 불가', '판정 불가', false, true],
    ['해당', '판정 불가', true, true],
  ])('%s / %s', (toxic, accidentPrep, hazardous, check) => {
    expect(isHazardous({ toxic, accidentPrep })).toBe(hazardous)
    expect(needsCheck({ toxic, accidentPrep })).toBe(check)
  })
})
