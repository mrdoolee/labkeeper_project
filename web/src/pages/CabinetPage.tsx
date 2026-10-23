import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { records, type Cabinet, type Room, type Zone } from '../api/records'
import { CABINET_TYPES, STORAGE_CLASSES, planZones, type CabinetType } from '../domain/storage'
import { ErrorMessage, errorText } from '../components/Field'
import { useBusy } from '../components/useBusy'
import { HistoryButton } from '../components/HistoryDialog'
import { LastEdited, useDirectory } from '../components/LastEdited'

const SHORT_LABEL = Object.fromEntries(STORAGE_CLASSES.map((c) => [c.id, c.label.split('(')[0]]))

type CabinetForm = Pick<Cabinet, 'name' | 'type' | 'locked' | 'rows' | 'cols'>

function ZoneEditor({ zone, onSaved }: { zone: Zone; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(zone.name)
  const [classes, setClasses] = useState(zone.allowedClasses.split(',').filter(Boolean))
  const [error, setError] = useState<string | null>(null)

  function toggle(id: string) {
    setClasses((cur) => (cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id]))
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    const allowedClasses = STORAGE_CLASSES.map((c) => c.id)
      .filter((id) => classes.includes(id))
      .join(',')
    try {
      await records.update('Zones', zone.id, { name, allowedClasses })
      await onSaved()
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <form className="card zone-editor" onSubmit={save} aria-label="구역 편집">
      <h2>
        {zone.row}단 {zone.col}칸
      </h2>
      <ErrorMessage message={error} />
      <div className="field">
        <label htmlFor="zone-name">구역 이름</label>
        <input id="zone-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <fieldset>
        <legend>허용 보관 분류</legend>
        {STORAGE_CLASSES.map((c) => (
          <label key={c.id} className="check" title={c.examples}>
            <input type="checkbox" checked={classes.includes(c.id)} onChange={() => toggle(c.id)} /> {c.label}
          </label>
        ))}
      </fieldset>
      <div className="toolbar">
        <button className="primary" type="submit">
          구역 저장
        </button>
        <HistoryButton table="Zones" recordId={zone.id} />
      </div>
    </form>
  )
}

export default function CabinetPage() {
  const { cabinetId = '' } = useParams()
  const nameOf = useDirectory()
  const [cabinet, setCabinet] = useState<Cabinet | null>(null)
  const [room, setRoom] = useState<Room | null>(null)
  const [zones, setZones] = useState<Zone[]>([])
  const [form, setForm] = useState<CabinetForm | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { busy, run } = useBusy(setError)

  const loadZones = useCallback(async () => setZones(await records.list('Zones', { cabinetId })), [cabinetId])

  const load = useCallback(async () => {
    const [cabs, zoneList] = await Promise.all([records.list('Cabinets', { id: cabinetId }), records.list('Zones', { cabinetId })])
    const cab = cabs[0] ?? null
    setCabinet(cab)
    setZones(zoneList)
    if (cab) {
      setForm({ name: cab.name, type: cab.type, locked: cab.locked, rows: cab.rows, cols: cab.cols })
      setRoom((await records.list('Rooms', { id: cab.roomId }))[0] ?? null)
    }
  }, [cabinetId])

  useEffect(() => {
    load().catch((err) => setError(errorText(err)))
  }, [load])

  async function saveCabinet(e: FormEvent) {
    e.preventDefault()
    if (!cabinet || !form || busy) return
    const plan = planZones({ ...cabinet, ...form }, zones)
    if (plan.remove.length > 0) {
      const names = zones.filter((z) => plan.remove.includes(z.id)).map((z) => z.name)
      if (!window.confirm(`다음 구역 ${names.length}개가 사라집니다: ${names.join(', ')}\n계속할까요? (변경 이력에는 남습니다)`)) return
    }
    const changes = Object.fromEntries(Object.entries(form).filter(([k, v]) => cabinet[k as keyof CabinetForm] !== v))
    await run(async () => {
      if (Object.keys(changes).length) await records.update('Cabinets', cabinet.id, changes)
      if (plan.create.length) await records.createMany('Zones', plan.create as unknown as Record<string, unknown>[])
      if (plan.remove.length) await records.removeMany('Zones', plan.remove)
      if (selected && plan.remove.includes(selected)) setSelected(null)
      await load()
    })
  }

  if (!cabinet || !form) return error ? <ErrorMessage message={error} /> : <p>불러오는 중…</p>

  const shelves = Array.from({ length: cabinet.rows }, (_, i) => i + 1)
  const slots = Array.from({ length: cabinet.cols }, (_, i) => i + 1)
  const at = (row: number, col: number) => zones.find((z) => z.row === row && z.col === col)
  const selectedZone = zones.find((z) => z.id === selected)

  return (
    <section>
      <p className="meta">
        <Link to="/rooms">교실·보관장</Link> › {room ? <Link to={`/rooms/${room.id}`}>{room.name}</Link> : '…'}
      </p>
      <div className="toolbar">
        <h1>{cabinet.name}</h1>
        <span className="meta">{room ? `${room.name} › ${cabinet.name}` : ''}</span>
        <span className="spacer" />
        <LastEdited by={cabinet.updatedBy} at={cabinet.updatedAt} nameOf={nameOf} />
        <HistoryButton table="Cabinets" recordId={cabinet.id} />
      </div>
      <ErrorMessage message={error} />
      <form className="card toolbar" onSubmit={saveCabinet} aria-label="보관장 정보">
        <input aria-label="보관장 이름" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <select aria-label="종류" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CabinetType })}>
          {CABINET_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={form.locked} onChange={(e) => setForm({ ...form, locked: e.target.checked })} /> 잠금
        </label>
        <label>
          단 수 <input aria-label="단 수" type="number" min={1} max={20} value={form.rows} onChange={(e) => setForm({ ...form, rows: Number(e.target.value) })} />
        </label>
        <label>
          칸 수 <input aria-label="칸 수" type="number" min={1} max={20} value={form.cols} onChange={(e) => setForm({ ...form, cols: Number(e.target.value) })} />
        </label>
        <button type="submit" disabled={busy}>
          보관장 저장
        </button>
      </form>

      <div className="cabinet-layout">
        <div role="grid" aria-label="보관장 구역" className="zone-grid" style={{ gridTemplateColumns: `repeat(${cabinet.cols}, minmax(110px, 1fr))` }}>
          {shelves.map((row) => (
            <div role="row" key={row} className="zone-row">
              {slots.map((col) => {
                const zone = at(row, col)
                return (
                  <button
                    type="button"
                    role="gridcell"
                    key={col}
                    className={`zone${zone?.id === selected ? ' selected' : ''}`}
                    aria-selected={zone?.id === selected}
                    disabled={!zone}
                    onClick={() => zone && setSelected(zone.id)}
                  >
                    <strong>{zone?.name ?? `${row}단 ${col}칸`}</strong>
                    <span className="meta">
                      {(zone?.allowedClasses ?? '')
                        .split(',')
                        .filter(Boolean)
                        .map((id) => SHORT_LABEL[id])
                        .join(' · ')}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        {selectedZone ? (
          <ZoneEditor key={selectedZone.id} zone={selectedZone} onSaved={loadZones} />
        ) : (
          <p className="hint">구역을 누르면 이름과 허용 보관 분류를 바꿀 수 있습니다.</p>
        )}
      </div>
    </section>
  )
}
