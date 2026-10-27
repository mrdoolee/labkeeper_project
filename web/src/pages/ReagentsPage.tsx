import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { reagentsApi, type Reagent } from '../api/reagents'
import { ErrorMessage, errorText } from '../components/Field'
import { formatTime } from '../components/HistoryDialog'
import { HazardBadges } from '../components/HazardBadges'
import { TxDialog } from '../components/TxDialog'
import { usePlaces } from '../components/usePlaces'
import { isHazardous } from '../domain/hazard'
import { reagentLabel } from '../domain/location'

function matches(r: Reagent, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [r.name, r.casNo, r.formula].some((v) => v.toLowerCase().includes(q))
}

function DeletedReagents({ onRestored }: { onRestored: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Reagent[]>([])
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setRows((await reagentsApi.list(true)).filter((r) => r.deleted))
  }

  async function toggle() {
    if (!open) await load().catch((err) => setError(errorText(err)))
    setOpen(!open)
  }

  async function restore(r: Reagent) {
    try {
      await reagentsApi.restore(r.id)
      await load()
      await onRestored()
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <div className="deleted-list">
      <button type="button" onClick={toggle}>
        {open ? '삭제된 시약 숨기기' : '삭제된 시약 보기'}
      </button>
      <ErrorMessage message={error} />
      {open && (
        <ul>
          {rows.length === 0 && <li className="hint">삭제된 시약이 없습니다.</li>}
          {rows.map((r) => (
            <li key={r.id}>
              <span>{reagentLabel(r)}</span> <span className="meta">삭제 {formatTime(r.deletedAt)}</span>{' '}
              <button type="button" onClick={() => restore(r)}>
                복구
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function ReagentsPage() {
  const places = usePlaces()
  const [reagents, setReagents] = useState<Reagent[] | null>(null)
  const [query, setQuery] = useState('')
  const [hazardOnly, setHazardOnly] = useState(false)
  const [dialog, setDialog] = useState<{ reagent: Reagent; mode: 'in' | 'out' } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const list = await reagentsApi.list()
    setReagents(list.sort((a, b) => reagentLabel(a).localeCompare(reagentLabel(b), 'ko')))
  }, [])

  useEffect(() => {
    load().catch((err) => setError(errorText(err)))
  }, [load])

  const shown = useMemo(() => (reagents ?? []).filter((r) => matches(r, query) && (!hazardOnly || isHazardous(r))), [reagents, query, hazardOnly])

  function saved(reagentId: string, stock: number) {
    setReagents((list) => (list ?? []).map((r) => (r.id === reagentId ? { ...r, stock } : r)))
    setDialog(null)
  }

  return (
    <section>
      <div className="toolbar">
        <h1>시약</h1>
        <span className="spacer" />
        <Link className="button primary" to="/reagents/new">
          시약 등록
        </Link>
        <Link className="button" to="/reagents/import">
          엑셀로 등록
        </Link>
        <Link className="button" to="/reagents/ledger">
          대장 출력
        </Link>
      </div>
      <ErrorMessage message={error} />
      <div className="toolbar">
        <input aria-label="시약 검색" placeholder="약품명, CAS No., 화학식 일부" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label>
          <input type="checkbox" checked={hazardOnly} onChange={(e) => setHazardOnly(e.target.checked)} /> 유해화학물질만
        </label>
        <span className="meta">
          {shown.length}건 / 전체 {reagents?.length ?? 0}건
        </span>
      </div>
      {reagents === null && !error && <p>불러오는 중…</p>}
      {reagents && (
        <table className="reagent-table card">
          <thead>
            <tr>
              <th>약품명</th>
              <th>현재 보유량</th>
              <th>보관 위치</th>
              <th>유효기간</th>
              <th>기록</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={`/reagents/${r.id}`}>{reagentLabel(r)}</Link> <HazardBadges reagent={r} />
                </td>
                <td className="num">
                  {r.stock} {r.unit}
                </td>
                <td>{places.get(r.zoneId)?.label ?? <span className="hint">위치 미지정</span>}</td>
                <td>{r.expiryDate}</td>
                <td className="actions">
                  <button type="button" className="primary" onClick={() => setDialog({ reagent: r, mode: 'out' })}>
                    사용 기록
                  </button>
                  <button type="button" onClick={() => setDialog({ reagent: r, mode: 'in' })}>
                    입고
                  </button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="hint">
                  {reagents.length === 0 ? '등록된 시약이 없습니다. 시약 등록 또는 엑셀로 등록을 눌러 주세요.' : '찾는 시약이 없습니다.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {dialog && <TxDialog reagent={dialog.reagent} mode={dialog.mode} onClose={() => setDialog(null)} onSaved={(stock) => saved(dialog.reagent.id, stock)} />}
      <DeletedReagents onRestored={load} />
    </section>
  )
}
