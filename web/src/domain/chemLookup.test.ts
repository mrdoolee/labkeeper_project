import { describe, expect, test } from 'vitest'
import type { ChemClass } from '../api/chem'
import { judgeFromClasses, thresholdOf } from './chemLookup'

const cls = (type: string, content = '', exception = ''): ChemClass => ({ type, content, exception })

// Classes as the KECO API gave them on 2026-10-29.
const HCL = [cls('인체등유해성물질', '인체급성유해성 : 10%'), cls('사고대비물질', '염화 수소 및 이를 10% 이상 함유한 혼합물')]
const KMNO4 = [cls('인체등유해성물질', '인체급성유해성 : 5%, 생태유해성 : 2.5%'), cls('사고대비물질', '과망간산 칼륨 및 이를 98% 이상 함유한 혼합물')]
const FORMALDEHYDE = [
  cls('인체등유해성물질', '인체급성유해성 : 1%, 인체만성유해성 : 0.1%'),
  cls('제한물질', '폼알데하이드 및 이를 1% 이상 함유한 혼합물', '가구용 무늬목'),
  cls('사고대비물질', '포르말린 또는 포름알데히드 및 이를 1% 이상 함유한 혼합물'),
  cls('중점관리물질', '', 'CMR'),
]
const BENZIDINE = [cls('인체등유해성물질', '인체만성유해성 : 0.1%, 생태유해성 : 25%'), cls('금지물질', '벤지딘과 그 염류 및 그 중 하나를 0.1% 이상 함유한 혼합물')]
const ASBESTOS = [cls('금지물질 세분류', '청석면[Crocidolite; 12001-28-4], 갈석면[Amosite; 12172-73-5]')]

describe('thresholdOf', () => {
  test.each([
    ['인체급성유해성 : 10%', 10],
    ['인체급성유해성 : 5%, 생태유해성 : 2.5%', 2.5],
    ['염화 수소 및 이를 10% 이상 함유한 혼합물', 10],
    ['청석면[Crocidolite; 12001-28-4]', 0],
    ['', 0],
  ])('%s → %s', (content, expected) => {
    expect(thresholdOf(content)).toBe(expected)
  })
})

describe('judgeFromClasses', () => {
  test('concentrated hydrochloric acid is both; a dilute one neither', () => {
    expect(judgeFromClasses(HCL, 35)).toEqual({ toxic: '해당', accidentPrep: '해당', banned: false, permitted: false, restricted: false })
    expect(judgeFromClasses(HCL, 10)).toMatchObject({ toxic: '해당', accidentPrep: '해당' })
    expect(judgeFromClasses(HCL, 5)).toMatchObject({ toxic: '해당 없음', accidentPrep: '해당 없음' })
  })

  test('the lowest of the hazard limits counts, the ecological one included', () => {
    expect(judgeFromClasses(KMNO4, 3)).toMatchObject({ toxic: '해당', accidentPrep: '해당 없음' })
    expect(judgeFromClasses(KMNO4, 2)).toMatchObject({ toxic: '해당 없음' })
  })

  test('a blank concentration is a pure substance', () => {
    expect(judgeFromClasses(KMNO4, null)).toMatchObject({ toxic: '해당', accidentPrep: '해당' })
  })

  test('restricted, banned and permitted follow their own limits', () => {
    expect(judgeFromClasses(FORMALDEHYDE, 37)).toEqual({ toxic: '해당', accidentPrep: '해당', banned: false, permitted: false, restricted: true })
    expect(judgeFromClasses(FORMALDEHYDE, 0.5)).toMatchObject({ toxic: '해당', accidentPrep: '해당 없음', restricted: false })
    expect(judgeFromClasses(BENZIDINE, 100)).toMatchObject({ banned: true })
    expect(judgeFromClasses([cls('허가물질', '어떤 물질 및 이를 0.1% 이상 함유한 혼합물')], 50)).toMatchObject({ permitted: true })
  })

  test('a class without a percentage applies at any concentration', () => {
    expect(judgeFromClasses(ASBESTOS, 1)).toMatchObject({ banned: true })
  })

  test('the old name 유독물질 still counts as toxic', () => {
    expect(judgeFromClasses([cls('유독물질', '이를 25% 이상 함유한 혼합물')], 30)).toMatchObject({ toxic: '해당' })
  })

  test('a substance with no classes is neither', () => {
    expect(judgeFromClasses([], 100)).toEqual({ toxic: '해당 없음', accidentPrep: '해당 없음', banned: false, permitted: false, restricted: false })
  })
})
