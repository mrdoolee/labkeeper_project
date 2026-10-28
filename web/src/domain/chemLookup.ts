// 찾은 화학물질 정보로 판정 (설계: docs/superpowers/specs/2026-10-29-chem-lookup-design.md).
// The KECO classes carry their limits as text ("인체급성유해성 : 5%, 생태유해성 : 2.5%",
// "… 및 이를 10% 이상 함유한 혼합물"). Since the 2025-08-07 law change 유독물질 is
// 인체등유해성물질; the ledger forms still call the box 유독물질.
import type { ChemClass } from '../api/chem'
import type { HazardStatus } from './hazard'

/** Lowest percentage in the text; 0 (any concentration) when it has none. */
export function thresholdOf(content: string): number {
  const values = [...content.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1]))
  return values.length ? Math.min(...values) : 0
}

export interface ChemJudgment {
  toxic: HazardStatus
  accidentPrep: HazardStatus
  banned: boolean
  permitted: boolean
  restricted: boolean
}

/** A blank concentration is a pure substance (100%), as in judgeHazard. */
export function judgeFromClasses(classes: ChemClass[], concentration: number | null): ChemJudgment {
  const c = concentration ?? 100
  const applies = (pattern: RegExp) => classes.some((k) => pattern.test(k.type) && c >= thresholdOf(k.content))
  const status = (pattern: RegExp): HazardStatus => (applies(pattern) ? '해당' : '해당 없음')
  return {
    toxic: status(/^(인체등유해성물질|유독물질)/),
    accidentPrep: status(/^사고대비물질/),
    banned: applies(/^금지물질/),
    permitted: applies(/^허가물질/),
    restricted: applies(/^제한물질/),
  }
}
