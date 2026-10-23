import { useEffect, useState } from 'react'
import { callApi } from '../api/client'
import { formatTime } from './HistoryDialog'

/** id → name for everyone who ever wrote a record (directory.list). */
export function useDirectory(): (id: string) => string {
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    callApi<{ id: string; name: string }[]>('directory.list')
      .then((list) => setNames(Object.fromEntries(list.map((p) => [p.id, p.name]))))
      .catch(() => {})
  }, [])
  return (id) => names[id] ?? ''
}

/** "김운영 · 2026-03-02 18:00": who last changed a row, and when. */
export function LastEdited({ by, at, nameOf }: { by: string; at: string; nameOf: (id: string) => string }) {
  return (
    <span className="meta">
      {nameOf(by)} · {formatTime(at)}
    </span>
  )
}
