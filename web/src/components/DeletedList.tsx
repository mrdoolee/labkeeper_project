import { useState } from 'react'
import { records } from '../api/records'
import { formatTime } from './HistoryDialog'

type Restorable = 'Rooms' | 'Cabinets'

/**
 * "삭제된 … 보기" toggle: lists soft-deleted rows with who deleted them,
 * and restores one on request.
 */
export function DeletedList({
  table,
  label,
  where,
  nameOf,
  onRestored,
}: {
  table: Restorable
  label: string
  where?: Record<string, unknown>
  nameOf: (id: string) => string
  onRestored: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<{ id: string; name: string; deletedBy: string; deletedAt: string }[]>([])
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setRows(await records.listDeleted(table, where))
  }

  async function toggle(checked: boolean) {
    setOpen(checked)
    if (checked) await load().catch(() => setError('삭제된 항목을 불러오지 못했습니다.'))
  }

  async function restore(id: string) {
    try {
      await records.restore(table, id)
      await load()
      await onRestored()
    } catch (err) {
      setError(err instanceof Error ? err.message : '복구하지 못했습니다.')
    }
  }

  return (
    <div className="deleted-list">
      <label>
        <input type="checkbox" checked={open} onChange={(e) => toggle(e.target.checked)} /> 삭제된 {label} 보기
      </label>
      {open && (
        <>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {rows.length === 0 ? (
            <p className="hint">삭제된 {label}이 없습니다.</p>
          ) : (
            <table aria-label={`삭제된 ${label}`}>
              <thead>
                <tr>
                  <th>이름</th>
                  <th>삭제</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td className="meta">
                      {nameOf(r.deletedBy)} · {formatTime(r.deletedAt)}
                    </td>
                    <td>
                      <button type="button" onClick={() => restore(r.id)}>
                        복구
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}
