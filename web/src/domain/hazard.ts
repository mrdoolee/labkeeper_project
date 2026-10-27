// 유독물질·사고대비물질 판정 (설계 M2 6장). CAS No. + 농도를 부록9 기준농도와 비교한다.
import { HAZARD_THRESHOLDS } from '../data/hazardThresholds'

export type HazardStatus = '해당' | '해당 없음' | '판정 불가'

/** CAS 형식(2~7자리-2자리-1자리)과 마지막 검사 숫자를 확인한다. */
export function isValidCas(cas: string): boolean {
  const m = /^(\d{2,7})-(\d{2})-(\d)$/.exec(cas.trim())
  if (!m) return false
  const digits = (m[1] + m[2]).split('').reverse()
  const sum = digits.reduce((acc, d, i) => acc + Number(d) * (i + 1), 0)
  return sum % 10 === Number(m[3])
}

function status(threshold: number | null, concentration: number): HazardStatus {
  return threshold !== null && concentration >= threshold ? '해당' : '해당 없음'
}

/** 농도가 비어 있으면 순물질(100%)로 본다. */
export function judgeHazard(casNo: string, concentration: number | null): { toxic: HazardStatus; accidentPrep: HazardStatus } {
  const row = HAZARD_THRESHOLDS.find((r) => r.cas === casNo.trim())
  if (!row) return { toxic: '판정 불가', accidentPrep: '판정 불가' }
  const c = concentration ?? 100
  return { toxic: status(row.toxic, c), accidentPrep: status(row.accident, c) }
}

export function isHazardous(r: { toxic: string; accidentPrep: string }): boolean {
  return r.toxic === '해당' || r.accidentPrep === '해당'
}

export function needsCheck(r: { toxic: string; accidentPrep: string }): boolean {
  return r.toxic === '판정 불가' || r.accidentPrep === '판정 불가'
}
