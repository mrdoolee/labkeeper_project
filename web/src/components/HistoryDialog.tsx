import { useEffect, useState } from 'react'
import { callApi } from '../api/client'
import { ErrorMessage, errorText } from './Field'

export interface AuditEntry {
  id: string
  at: string
  userId: string
  userName: string
  table: string
  recordId: string
  action: 'create' | 'update' | 'delete' | 'restore' | 'login' | 'passwordChange' | 'passwordReset'
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

const ACTION_LABELS: Record<string, string> = {
  create: '추가',
  update: '수정',
  delete: '삭제',
  restore: '복구',
  login: '로그인',
  passwordChange: '비밀번호 변경',
  passwordReset: '비밀번호 초기화',
}

// Korean names for columns and settings shown in the history.
const FIELD_LABELS: Record<string, string> = {
  name: '이름',
  note: '메모',
  isLab: '과학실 여부',
  roomId: '교실',
  type: '종류',
  locked: '잠금',
  rows: '단 수',
  cols: '칸 수',
  cabinetId: '보관장',
  row: '단',
  col: '칸',
  allowedClasses: '허용 보관 분류',
  role: '역할',
  active: '사용 여부',
  mustChangePassword: '비밀번호 변경 필요',
  schoolName: '학교 이름',
  schoolLevel: '학교급',
  region: '장부 양식 지역',
  signerScienceHead: '과학부장',
  signerVicePrincipal: '교감',
  signerPrincipal: '교장',
  labOver100m2: '실험실 면적 100㎡ 이상',
  wasteDisposal: '폐수 처리 방식',
}

function show(value: unknown): string {
  if (value === true) return '예'
  if (value === false) return '아니요'
  if (value === null || value === undefined || value === '') return '(없음)'
  return String(value)
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function changes(entry: AuditEntry): string[] {
  if (entry.action !== 'update' || !entry.after) return []
  return Object.keys(entry.after).map((key) => `${FIELD_LABELS[key] ?? key}: ${show(entry.before?.[key])} → ${show(entry.after?.[key])}`)
}

/** Name of the record an entry is about: from the caller's names, else from the entry itself. */
function targetName(e: AuditEntry, names?: Record<string, string>): string {
  const fromEntry = (e.after?.name ?? e.before?.name) as string | undefined
  return names?.[e.recordId] ?? fromEntry ?? (e.table === 'Settings' ? FIELD_LABELS[e.recordId] ?? e.recordId : '(이름 없음)')
}

export default function HistoryDialog({
  table,
  recordId,
  names,
  onClose,
}: {
  table: string
  recordId?: string
  /** id → name, used to label rows in the whole-table view. */
  names?: Record<string, string>
  onClose: () => void
}) {
  const wholeTable = !recordId
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    callApi<AuditEntry[]>('audit.list', recordId ? { table, recordId } : { table })
      .then(setEntries)
      .catch((err) => setError(errorText(err)))
  }, [table, recordId])

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog card" role="dialog" aria-modal="true" aria-labelledby="history-title" onClick={(e) => e.stopPropagation()}>
        <div className="toolbar">
          <h2 id="history-title">변경 이력</h2>
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </div>
        <ErrorMessage message={error} />
        {entries === null && !error && <p>불러오는 중…</p>}
        {entries && entries.length === 0 && <p className="hint">기록이 없습니다.</p>}
        {entries && entries.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>일시</th>
                <th>사람</th>
                {wholeTable && <th>대상</th>}
                <th>동작</th>
                <th>바뀐 항목</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{formatTime(e.at)}</td>
                  <td>{e.userName}</td>
                  {wholeTable && <td>{targetName(e, names)}</td>}
                  <td>{ACTION_LABELS[e.action] ?? e.action}</td>
                  <td>
                    {changes(e).map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

/** A "변경 이력" button that opens the dialog. */
export function HistoryButton({
  table,
  recordId,
  names,
  label = '변경 이력',
}: {
  table: string
  recordId?: string
  names?: Record<string, string>
  label?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && <HistoryDialog table={table} recordId={recordId} names={names} onClose={() => setOpen(false)} />}
    </>
  )
}
