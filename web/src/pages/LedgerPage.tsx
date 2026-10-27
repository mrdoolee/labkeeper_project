import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { callApi } from '../api/client'
import { reagentsApi, type Reagent } from '../api/reagents'
import { ErrorMessage, SelectField, errorText } from '../components/Field'
import { needsCheck } from '../domain/hazard'
import { ledgerLines, schoolYearOf, schoolYearRange, todayKst, type TxRow } from '../domain/ledger'
import { reagentLabel } from '../domain/location'
import { LedgerSheets, type Region } from '../print/LedgerSheets'
import '../print/print.css'

const REGION_NAMES: Record<Region, string> = { chungbuk: '충북 서식3', seoul: '서울 양식', gyeonggi: '경기 서식3' }

export default function LedgerPage() {
  const [params, setParams] = useSearchParams()
  const thisYear = schoolYearOf(todayKst())
  const [year, setYear] = useState(thisYear)
  const [region, setRegion] = useState<Region | null>(null)
  const [reagents, setReagents] = useState<Reagent[] | null>(null)
  const [txs, setTxs] = useState<TxRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const idsText = params.get('ids') ?? ''
  const ids = useMemo(() => idsText.split(',').filter(Boolean), [idsText])

  useEffect(() => {
    Promise.all([callApi<{ region: Region }>('settings.get'), reagentsApi.list(true), reagentsApi.txList({ to: schoolYearRange(thisYear).end })])
      .then(([settings, list, records]) => {
        setRegion(settings.region)
        setReagents(list.sort((a, b) => reagentLabel(a).localeCompare(reagentLabel(b), 'ko')))
        setTxs(records)
      })
      .catch((err) => setError(errorText(err)))
  }, [thisYear])

  const byReagent = useMemo(() => {
    const map = new Map<string, TxRow[]>()
    for (const t of txs) map.set(t.reagentId, [...(map.get(t.reagentId) ?? []), t])
    return map
  }, [txs])

  const items = useMemo(
    () =>
      (reagents ?? [])
        .filter((r) => ids.length === 0 || ids.includes(r.id))
        .map((reagent) => ({ reagent, lines: ledgerLines(byReagent.get(reagent.id) ?? [], year) }))
        .filter((item) => item.lines.length > 0),
    [reagents, byReagent, year, ids],
  )

  const years = useMemo(() => {
    const first = txs.reduce((min, t) => (t.date < min ? t.date : min), todayKst())
    const out: number[] = []
    for (let y = thisYear; y >= schoolYearOf(first); y--) out.push(y)
    return out
  }, [txs, thisYear])

  const unjudged = items.filter((i) => needsCheck(i.reagent)).map((i) => i.reagent)

  if (error) return <ErrorMessage message={error} />
  if (!reagents || !region) return <p>불러오는 중…</p>

  return (
    <section className="ledger-page">
      <div className="toolbar no-print">
        <h1>화학약품 관리대장</h1>
        <span className="meta">{REGION_NAMES[region]} (설정에서 바꿈)</span>
        <span className="spacer" />
        <Link to="/reagents">시약 목록</Link>
      </div>
      <div className="card toolbar no-print">
        <SelectField label="학년도" value={String(year)} options={years.map((y) => ({ value: String(y), label: `${y}학년도` }))} onChange={(e) => setYear(Number(e.target.value))} />
        <SelectField
          label="시약"
          value={ids.length === 1 ? ids[0] : ''}
          options={[
            { value: '', label: ids.length > 1 ? `고른 시약 ${ids.length}개` : '전체' },
            ...reagents.map((r) => ({ value: r.id, label: `${reagentLabel(r)}${r.deleted ? ' (삭제됨)' : ''}` })),
          ]}
          onChange={(e) => setParams(e.target.value ? { ids: e.target.value } : {})}
        />
        <span className="meta">{items.length}개 시약</span>
        <span className="spacer" />
        <button type="button" className="primary" onClick={() => window.print()} disabled={items.length === 0}>
          인쇄
        </button>
      </div>
      {unjudged.length > 0 && (
        <div className="notice no-print" role="status">
          <p>판정이 안 된 시약 {unjudged.length}개: 대장에 "확인 필요"로 찍힙니다.</p>
          <p>
            {unjudged.map((r, i) => (
              <span key={r.id}>
                {i > 0 && ', '}
                <Link to={`/reagents/${r.id}`}>{r.name}</Link>
              </span>
            ))}
          </p>
        </div>
      )}
      {items.length === 0 ? <p className="hint">이 학년도에 출력할 기록이 없습니다.</p> : <LedgerSheets region={region} year={year} items={items} />}
    </section>
  )
}
