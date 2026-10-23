import { useEffect, useState, type FormEvent } from 'react'
import { callApi } from '../api/client'
import { ErrorMessage, Field, Notice, SelectField, errorText } from '../components/Field'
import { HistoryButton } from '../components/HistoryDialog'

export interface Settings {
  schoolName: string
  schoolLevel: 'middle' | 'high'
  region: 'chungbuk' | 'seoul' | 'gyeonggi'
  signerScienceHead: string
  signerVicePrincipal: string
  signerPrincipal: string
  labOver100m2: boolean
  wasteDisposal: 'office' | 'self'
}

const REGIONS = [
  { value: 'chungbuk', label: '충북' },
  { value: 'seoul', label: '서울' },
  { value: 'gyeonggi', label: '경기' },
]
const LEVELS = [
  { value: 'middle', label: '중학교' },
  { value: 'high', label: '고등학교' },
]
const WASTE = [
  { value: 'office', label: '교육청 위탁' },
  { value: 'self', label: '학교 자체 처리' },
]

export default function SettingsPage() {
  const [saved, setSaved] = useState<Settings | null>(null)
  const [form, setForm] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    callApi<Settings>('settings.get')
      .then((s) => {
        setSaved(s)
        setForm(s)
      })
      .catch((err) => setError(errorText(err)))
  }, [])

  if (!form || !saved) return error ? <ErrorMessage message={error} /> : <p>불러오는 중…</p>

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f))
    setNotice(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form || !saved) return
    const changed = Object.fromEntries(
      (Object.keys(form) as (keyof Settings)[]).filter((k) => form[k] !== saved[k]).map((k) => [k, form[k]]),
    )
    if (Object.keys(changed).length === 0) return setNotice('바뀐 내용이 없습니다.')
    setBusy(true)
    setError(null)
    try {
      const next = await callApi<Settings>('settings.update', changed)
      setSaved(next)
      setForm(next)
      setNotice('저장했습니다.')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <div className="toolbar">
        <h1>설정</h1>
        <span className="spacer" />
        <HistoryButton table="Settings" />
      </div>
      <form className="card settings-form" onSubmit={submit}>
        <ErrorMessage message={error} />
        <Notice message={notice} />
        <h2>학교</h2>
        <Field label="학교 이름" value={form.schoolName} onChange={(e) => set('schoolName', e.target.value)} />
        <SelectField label="학교급" options={LEVELS} value={form.schoolLevel} onChange={(e) => set('schoolLevel', e.target.value as Settings['schoolLevel'])} />
        <SelectField label="장부 양식 지역" options={REGIONS} value={form.region} onChange={(e) => set('region', e.target.value as Settings['region'])} />
        <h2>장부 서명자</h2>
        <p className="hint">점검표와 장부를 출력할 때 이름이 들어갑니다. 서명란은 비워 둡니다.</p>
        <Field label="과학부장" value={form.signerScienceHead} onChange={(e) => set('signerScienceHead', e.target.value)} />
        <Field label="교감" value={form.signerVicePrincipal} onChange={(e) => set('signerVicePrincipal', e.target.value)} />
        <Field label="교장" value={form.signerPrincipal} onChange={(e) => set('signerPrincipal', e.target.value)} />
        <h2>폐수</h2>
        <div className="field checkbox">
          <label>
            <input type="checkbox" checked={form.labOver100m2} onChange={(e) => set('labOver100m2', e.target.checked)} /> 실험실 면적 100㎡ 이상
          </label>
          <span className="hint">고등학교에서 실험실 면적이 100㎡ 이상이면 폐수배출시설 점검 항목이 적용됩니다.</span>
        </div>
        <SelectField label="폐수 처리 방식" options={WASTE} value={form.wasteDisposal} onChange={(e) => set('wasteDisposal', e.target.value as Settings['wasteDisposal'])} />
        <button className="primary" type="submit" disabled={busy}>
          저장
        </button>
      </form>
    </section>
  )
}
