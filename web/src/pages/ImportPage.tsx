import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { reagentsApi, type ImportRow } from '../api/reagents'
import { ErrorMessage, Field, Notice, errorText } from '../components/Field'
import { usePlaces } from '../components/usePlaces'
import { schoolYearOf, schoolYearRange, todayKst } from '../domain/ledger'
import { reagentLabel } from '../domain/location'
import { duplicateKey, parseImport } from '../domain/reagentImport'

const CHUNK = 200

export default function ImportPage() {
  const places = usePlaces()
  const [existing, setExisting] = useState<Set<string> | null>(null)
  const [rawRows, setRawRows] = useState<unknown[][] | null>(null)
  const [fileName, setFileName] = useState('')
  const [defaultDate, setDefaultDate] = useState(schoolYearRange(schoolYearOf(todayKst())).start)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    reagentsApi
      .list()
      .then((list) => setExisting(new Set(list.map((r) => duplicateKey(r.name, r.concentration)))))
      .catch((err) => setError(errorText(err)))
  }, [done])

  const parsed = useMemo(
    () => (rawRows && existing ? parseImport(rawRows, { places, existingKeys: existing, defaultDate, today: todayKst() }) : null),
    [rawRows, existing, places, defaultDate],
  )
  const counts = { ok: 0, skip: 0, error: 0 }
  parsed?.forEach((r) => counts[r.status]++)

  async function download() {
    setError(null)
    try {
      const { buildTemplate } = await import('../excel/template')
      const blob = await buildTemplate([...places.values()])
      if (typeof URL.createObjectURL !== 'function') return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'LabKeeper 시약 등록 양식.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setDone(null)
    try {
      const { readWorkbook } = await import('../excel/template')
      setRawRows(await readWorkbook(file))
      setFileName(file.name)
    } catch {
      setError('엑셀 파일을 읽지 못했습니다. 내려받은 양식(.xlsx)에 입력했는지 확인해 주세요.')
    }
  }

  async function save() {
    if (!parsed || counts.error || !counts.ok || busy) return
    const rows: ImportRow[] = parsed
      .filter((r) => r.status === 'ok')
      .map((r) => ({ line: r.line, values: r.values!, initialAmount: r.initialAmount!, initialDate: r.initialDate! }))
    setBusy(true)
    setError(null)
    let created = 0
    let skipped = counts.skip
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const res = await reagentsApi.createMany(rows.slice(i, i + CHUNK))
        created += res.created.length
        skipped += res.skippedLines.length
      }
      setDone(`${created}건 등록, ${skipped}건 건너뜀`)
      setRawRows(null)
    } catch (err) {
      setError(`${created}건까지 저장됨. 나머지는 저장하지 못했습니다: ${errorText(err)} 같은 파일을 다시 올리면 저장된 줄은 건너뜁니다.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <div className="toolbar">
        <h1>엑셀로 시약 등록</h1>
        <span className="spacer" />
        <Link to="/reagents">시약 목록</Link>
      </div>
      <ErrorMessage message={error} />
      <Notice message={done} />
      <ol className="card import-steps">
        <li>
          <button type="button" onClick={download}>
            양식 내려받기
          </button>{' '}
          <span className="hint">보관 위치 목록이 이 학교의 교실·보관장으로 채워집니다. 2번째 줄은 예시입니다.</span>
        </li>
        <li>
          <Field label="비어 있는 기준일" type="date" value={defaultDate} max={todayKst()} onChange={(e) => setDefaultDate(e.target.value)} hint="기준일 칸을 비운 줄은 이 날짜로 등록합니다." />
        </li>
        <li>
          <div className="field">
            <label htmlFor="import-file">엑셀 파일</label>
            <input id="import-file" type="file" accept=".xlsx" onChange={choose} />
          </div>
        </li>
      </ol>

      {parsed && (
        <>
          <div className="toolbar">
            <h2>미리보기 {fileName && <span className="meta">{fileName}</span>}</h2>
            <span className="spacer" />
            <strong>
              등록 {counts.ok}건 · 건너뜀 {counts.skip}건 · 오류 {counts.error}건
            </strong>
            <button type="button" className="primary" onClick={save} disabled={busy || counts.error > 0 || counts.ok === 0}>
              저장
            </button>
          </div>
          {counts.error > 0 && <p className="error">오류가 있는 줄을 엑셀에서 고친 뒤 다시 올려 주세요.</p>}
          <table className="card import-table" aria-label="미리보기">
            <thead>
              <tr>
                <th>줄</th>
                <th>약품명</th>
                <th>단위</th>
                <th>기초 재고량</th>
                <th>기준일</th>
                <th>유독/사고대비</th>
                <th>보관 위치</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {parsed.map((r) => (
                <tr key={r.line} className={r.status === 'error' ? 'row-error' : r.status === 'skip' ? 'row-skip' : undefined}>
                  <td>{r.line}</td>
                  <td>{r.values?.name ? reagentLabel({ name: r.values.name, concentration: r.values.concentration ?? null }) : ''}</td>
                  <td>{r.values?.unit ?? ''}</td>
                  <td className="num">{Number.isFinite(r.initialAmount) ? r.initialAmount : ''}</td>
                  <td>{r.initialDate}</td>
                  <td>
                    {r.values?.toxic} / {r.values?.accidentPrep}
                  </td>
                  <td>{r.values?.zoneId ? places.get(r.values.zoneId)?.label : ''}</td>
                  <td>{r.status === 'error' ? r.errors.join(' ') : r.status === 'skip' ? '이미 등록됨 – 건너뜀' : '등록'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
