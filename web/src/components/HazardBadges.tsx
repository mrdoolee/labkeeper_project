import type { Reagent } from '../api/reagents'
import { isHazardous, needsCheck } from '../domain/hazard'

/** 유해 = 유독물질 또는 사고대비물질 해당, 확인 필요 = 판정 불가. */
export function HazardBadges({ reagent }: { reagent: Pick<Reagent, 'toxic' | 'accidentPrep'> }) {
  return (
    <>
      {isHazardous(reagent) && <span className="badge badge-danger">유해</span>}
      {needsCheck(reagent) && <span className="badge badge-warn">확인 필요</span>}
    </>
  )
}
