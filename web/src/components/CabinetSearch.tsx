import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { records, type Cabinet, type Room } from '../api/records'

/** Top-bar search: type part of a cabinet name, pick "room › cabinet", jump there. */
export default function CabinetSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [data, setData] = useState<{ rooms: Record<string, string>; cabinets: Cabinet[] } | null>(null)

  async function ensureLoaded() {
    if (data) return
    const [rooms, cabinets] = await Promise.all([records.list('Rooms'), records.list('Cabinets')])
    setData({ rooms: Object.fromEntries(rooms.map((r: Room) => [r.id, r.name])), cabinets })
  }

  const q = query.trim()
  const results = q && data ? data.cabinets.filter((c) => c.name.includes(q) && data.rooms[c.roomId] !== undefined).slice(0, 20) : []

  function open(cabinet: Cabinet) {
    setQuery('')
    navigate(`/cabinets/${cabinet.id}`)
  }

  return (
    <div className="cabinet-search">
      <input
        aria-label="보관장 찾기"
        placeholder="보관장 찾기"
        value={query}
        onFocus={() => ensureLoaded().catch(() => {})}
        onChange={(e) => {
          setQuery(e.target.value)
          ensureLoaded().catch(() => {})
        }}
      />
      {results.length > 0 && (
        <ul role="listbox" aria-label="보관장 검색 결과">
          {results.map((c) => (
            <li key={c.id} role="option" aria-selected="false" tabIndex={0} onClick={() => open(c)} onKeyDown={(e) => e.key === 'Enter' && open(c)}>
              {data!.rooms[c.roomId]} › {c.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
