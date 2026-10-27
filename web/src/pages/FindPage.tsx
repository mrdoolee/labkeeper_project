import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { reagentsApi, type Reagent } from '../api/reagents'
import { ErrorMessage, errorText } from '../components/Field'
import { HazardBadges } from '../components/HazardBadges'
import { usePlaces } from '../components/usePlaces'
import { reagentLabel } from '../domain/location'

/** 위치 찾기 (설계 M2 8-7): where each reagent is kept. Equipment joins in phase 2. */
export default function FindPage() {
  const places = usePlaces()
  const [reagents, setReagents] = useState<Reagent[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    reagentsApi
      .list()
      .then((list) => setReagents(list.sort((a, b) => reagentLabel(a).localeCompare(reagentLabel(b), 'ko'))))
      .catch((err) => setError(errorText(err)))
  }, [])

  const q = query.trim().toLowerCase()
  const found = useMemo(() => (q ? reagents.filter((r) => [r.name, r.casNo, r.formula].some((v) => v.toLowerCase().includes(q))) : []), [reagents, q])

  return (
    <section>
      <h1>위치 찾기</h1>
      <ErrorMessage message={error} />
      <div className="card">
        <input className="find-input" aria-label="찾을 시약" placeholder="약품명, CAS No., 화학식 일부 (예: 염산, HCl, 7647)" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      </div>
      {q && found.length === 0 && <p className="hint">찾는 시약이 없습니다.</p>}
      {found.length > 0 && (
        <ul className="find-results" aria-label="찾은 시약">
          {found.map((r) => {
            const place = places.get(r.zoneId)
            return (
              <li key={r.id} className="card">
                <div>
                  <Link to={`/reagents/${r.id}`}>{reagentLabel(r)}</Link> <HazardBadges reagent={r} />
                </div>
                <div>{place ? <Link to={`/cabinets/${place.cabinetId}?zone=${place.zoneId}`}>{place.label}</Link> : <span className="hint">위치 미지정</span>}</div>
                <div className="meta">
                  {r.stock} {r.unit}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
