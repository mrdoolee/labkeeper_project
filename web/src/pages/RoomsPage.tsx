import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { records, type Room } from '../api/records'
import { ErrorMessage, errorText } from '../components/Field'
import { HistoryButton } from '../components/HistoryDialog'
import { LastEdited, useDirectory } from '../components/LastEdited'

export default function RoomsPage() {
  const nameOf = useDirectory()
  const [rooms, setRooms] = useState<Room[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [query, setQuery] = useState('')
  const [labsOnly, setLabsOnly] = useState(false)
  const [newName, setNewName] = useState('')
  const [newIsLab, setNewIsLab] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [roomList, cabinets] = await Promise.all([records.list('Rooms'), records.list('Cabinets')])
    const byRoom: Record<string, number> = {}
    cabinets.forEach((c) => (byRoom[c.roomId] = (byRoom[c.roomId] ?? 0) + 1))
    setRooms(roomList)
    setCounts(byRoom)
  }, [])

  useEffect(() => {
    load().catch((err) => setError(errorText(err)))
  }, [load])

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      await load()
    } catch (err) {
      setError(errorText(err))
    }
  }

  function add(e: FormEvent) {
    e.preventDefault()
    run(async () => {
      await records.create('Rooms', { name: newName, isLab: newIsLab })
      setNewName('')
    })
  }

  function rename(room: Room) {
    const name = window.prompt('새 교실 이름', room.name)
    if (name && name.trim() && name !== room.name) run(() => records.update('Rooms', room.id, { name }))
  }

  function remove(room: Room) {
    const n = counts[room.id] ?? 0
    const warn = n > 0 ? `\n이 교실의 보관장 ${n}개도 목록에서 보이지 않게 됩니다.` : ''
    if (window.confirm(`'${room.name}'을(를) 삭제할까요?${warn}\n삭제한 기록은 변경 이력에 남습니다.`)) run(() => records.remove('Rooms', room.id))
  }

  const shown = rooms.filter((r) => (!labsOnly || r.isLab) && r.name.includes(query.trim()))

  return (
    <section>
      <div className="toolbar">
        <h1>교실·보관장</h1>
        <span className="spacer" />
        <HistoryButton table="Rooms" />
      </div>
      <ErrorMessage message={error} />
      <form className="card toolbar" onSubmit={add} aria-label="새 교실">
        <input aria-label="새 교실 이름" placeholder="교실 이름 (예: 제1과학실, 과학 준비실)" value={newName} onChange={(e) => setNewName(e.target.value)} required />
        <label>
          <input type="checkbox" checked={newIsLab} onChange={(e) => setNewIsLab(e.target.checked)} /> 과학실 (월간 점검 대상)
        </label>
        <button className="primary" type="submit">
          교실 추가
        </button>
      </form>
      <div className="toolbar">
        <input aria-label="교실 이름 검색" placeholder="교실 이름 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label>
          <input type="checkbox" checked={labsOnly} onChange={(e) => setLabsOnly(e.target.checked)} /> 과학실만 보기
        </label>
        <span className="meta">
          {shown.length}곳 / 전체 {rooms.length}곳
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>교실</th>
            <th>과학실</th>
            <th>보관장</th>
            <th>마지막 수정</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((room) => (
            <tr key={room.id}>
              <td>
                <Link to={`/rooms/${room.id}`}>{room.name}</Link>
              </td>
              <td>
                <input
                  type="checkbox"
                  aria-label={`${room.name} 과학실 여부`}
                  checked={room.isLab}
                  onChange={(e) => run(() => records.update('Rooms', room.id, { isLab: e.target.checked }))}
                />
              </td>
              <td>{counts[room.id] ?? 0}개</td>
              <td>
                <LastEdited by={room.updatedBy} at={room.updatedAt} nameOf={nameOf} />
              </td>
              <td>
                <div className="toolbar">
                <button type="button" onClick={() => rename(room)}>
                  이름 변경
                </button>
                <button type="button" className="danger" onClick={() => remove(room)}>
                  삭제
                </button>
                <HistoryButton table="Rooms" recordId={room.id} label="이력" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
