// 시약 등록의 "찾기": name (or CAS No.) → data.go.kr candidates → the picked one's info.
import { useState } from 'react'
import { chemApi, type ChemCandidate, type ChemInfo } from '../api/chem'
import { errorText } from './Field'

export function ChemFinder({ name, casNo, onPick }: { name: string; casNo: string; onPick: (candidate: ChemCandidate, info: ChemInfo) => void }) {
  const [items, setItems] = useState<ChemCandidate[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(work: () => Promise<void>) {
    setBusy(true)
    setMessage(null)
    try {
      await work()
    } catch (err) {
      setMessage(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  function search() {
    const query = name.trim() || casNo.trim()
    if (!query) {
      setItems([])
      setMessage('약품명이나 CAS No.를 먼저 입력해 주세요.')
      return
    }
    void run(async () => {
      setItems([])
      const found = (await chemApi.search(query)).items
      setItems(found)
      if (!found.length) setMessage('찾은 물질이 없습니다. 다른 이름(예: 옛 이름)이나 CAS No.로 찾아 보세요.')
    })
  }

  function pick(candidate: ChemCandidate) {
    void run(async () => {
      onPick(candidate, await chemApi.info(candidate.casNo))
      setItems([])
    })
  }

  return (
    <div className="chem-finder">
      <div className="toolbar">
        <button type="button" onClick={search} disabled={busy}>
          찾기
        </button>
        <span className="hint">{busy ? '찾는 중…' : '약품명(비어 있으면 CAS No.)으로 공공데이터에서 CAS No.·화학식·판정을 찾아 채웁니다.'}</span>
      </div>
      {message && <p className="hint">{message}</p>}
      {items.length > 0 && (
        <ul className="chem-candidates" aria-label="찾은 물질">
          {items.map((c) => (
            <li key={`${c.name}|${c.casNo}`}>
              <button type="button" onClick={() => pick(c)} disabled={busy}>
                {c.name} · {c.casNo}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
