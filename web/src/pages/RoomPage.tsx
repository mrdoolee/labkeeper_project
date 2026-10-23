import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { records, type Cabinet, type Room } from '../api/records'
import { CABINET_TYPES, copyZones, planZones, type CabinetType } from '../domain/storage'
import { ErrorMessage, errorText } from '../components/Field'
import { NotFound } from '../components/NotFound'
import { useBusy } from '../components/useBusy'
import { DeletedList } from '../components/DeletedList'
import { HistoryButton } from '../components/HistoryDialog'
import { LastEdited, useDirectory } from '../components/LastEdited'

export const CABINET_TYPE_LABEL = Object.fromEntries(CABINET_TYPES.map((t) => [t.id, t.label])) as Record<CabinetType, string>

export default function RoomPage() {
  const { roomId = '' } = useParams()
  const nameOf = useDirectory()
  const [room, setRoom] = useState<Room | null>(null)
  const [cabinets, setCabinets] = useState<Cabinet[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [form, setForm] = useState({ name: '', type: 'sealed' as CabinetType, locked: true, rows: 3, cols: 2 })

  const load = useCallback(async () => {
    const [rooms, list] = await Promise.all([records.list('Rooms', { id: roomId }), records.list('Cabinets', { roomId })])
    setRoom(rooms[0] ?? null)
    setCabinets(list)
  }, [roomId])

  useEffect(() => {
    load()
      .then(() => setLoaded(true))
      .catch((err) => setError(errorText(err)))
  }, [load])

  const { busy, run: runBusy } = useBusy(setError)
  const run = (action: () => Promise<unknown>) =>
    runBusy(async () => {
      await action()
      await load()
    })

  function add(e: FormEvent) {
    e.preventDefault()
    run(async () => {
      const cabinet = await records.create('Cabinets', { roomId, ...form })
      await records.createMany('Zones', planZones(cabinet, []).create as unknown as Record<string, unknown>[])
      setForm((f) => ({ ...f, name: '' }))
    })
  }

  function copy(source: Cabinet) {
    const name = window.prompt('복제할 보관장의 새 이름', `${source.name} (복사)`)
    if (!name || !name.trim()) return
    run(async () => {
      const { roomId: r, type, locked, rows, cols, note } = source
      const cabinet = await records.create('Cabinets', { roomId: r, name, type, locked, rows, cols, note })
      const zones = await records.list('Zones', { cabinetId: source.id })
      await records.createMany('Zones', copyZones(zones, cabinet.id) as unknown as Record<string, unknown>[])
    })
  }

  function remove(cabinet: Cabinet) {
    if (window.confirm(`'${cabinet.name}'을(를) 삭제할까요?\n삭제한 기록은 변경 이력에 남습니다.`)) run(() => records.remove('Cabinets', cabinet.id))
  }

  if (!room) {
    if (error) return <ErrorMessage message={error} />
    if (loaded) return <NotFound what="교실" />
    return <p>불러오는 중…</p>
  }
  const shown = cabinets.filter((c) => c.name.includes(query.trim()))

  return (
    <section>
      <p className="meta">
        <Link to="/rooms">교실·보관장</Link> › {room.name}
      </p>
      <div className="toolbar">
        <h1>{room.name}</h1>
        {room.isLab && <span className="badge">과학실</span>}
        <span className="spacer" />
        <HistoryButton table="Cabinets" names={Object.fromEntries(cabinets.map((c) => [c.id, c.name]))} />
      </div>
      <ErrorMessage message={error} />
      <form className="card toolbar" onSubmit={add} aria-label="새 보관장">
        <input aria-label="새 보관장 이름" placeholder="보관장 이름 (예: A 시약장)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <label>
          종류{' '}
          <select aria-label="종류" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CabinetType })}>
            {CABINET_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={form.locked} onChange={(e) => setForm({ ...form, locked: e.target.checked })} /> 잠금
        </label>
        <label>
          단 수 <input aria-label="단 수" type="number" min={1} max={20} value={form.rows} onChange={(e) => setForm({ ...form, rows: Number(e.target.value) })} />
        </label>
        <label>
          칸 수 <input aria-label="칸 수" type="number" min={1} max={20} value={form.cols} onChange={(e) => setForm({ ...form, cols: Number(e.target.value) })} />
        </label>
        <button className="primary" type="submit" disabled={busy}>
          보관장 추가
        </button>
      </form>
      <div className="toolbar">
        <input aria-label="보관장 이름 검색" placeholder="보관장 이름 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="meta">
          {shown.length}개 / 전체 {cabinets.length}개
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>보관장</th>
            <th>종류</th>
            <th>잠금</th>
            <th>크기</th>
            <th>마지막 수정</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((c) => (
            <tr key={c.id}>
              <td>
                <Link to={`/cabinets/${c.id}`}>{c.name}</Link>
              </td>
              <td>{CABINET_TYPE_LABEL[c.type]}</td>
              <td>{c.locked ? '잠금' : '—'}</td>
              <td>
                {c.rows}단 × {c.cols}칸
              </td>
              <td>
                <LastEdited by={c.updatedBy} at={c.updatedAt} nameOf={nameOf} />
              </td>
              <td>
                <div className="toolbar">
                <button type="button" onClick={() => copy(c)}>
                  복제
                </button>
                <button type="button" className="danger" onClick={() => remove(c)}>
                  삭제
                </button>
                <HistoryButton table="Cabinets" recordId={c.id} label="이력" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <DeletedList table="Cabinets" label="보관장" where={{ roomId }} nameOf={nameOf} onRestored={load} />
    </section>
  )
}
