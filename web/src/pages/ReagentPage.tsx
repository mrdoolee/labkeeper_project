import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { reagentsApi, type Reagent, type ReagentInput } from '../api/reagents'
import { ErrorMessage, Field, SelectField, errorText } from '../components/Field'
import { HazardBadges } from '../components/HazardBadges'
import { HistoryButton } from '../components/HistoryDialog'
import { PlacePicker } from '../components/PlacePicker'
import { TxDialog } from '../components/TxDialog'
import { useBusy } from '../components/useBusy'
import { isValidCas, judgeHazard, type HazardStatus } from '../domain/hazard'
import { runningBalances, schoolYearOf, schoolYearRange, todayKst, type TxRow } from '../domain/ledger'
import { reagentLabel } from '../domain/location'

type Form = {
  name: string
  concentration: string
  formula: string
  casNo: string
  grade: ReagentInput['grade']
  unit: ReagentInput['unit']
  mainUse: string
  expiryDate: string
  purchaseDate: string
  openedDate: string
  maker: string
  supplier: string
  zoneId: string
  toxic: HazardStatus
  accidentPrep: HazardStatus
  hazardManual: boolean
  poison: boolean
  banned: boolean
  permitted: boolean
  restricted: boolean
  note: string
}

const EMPTY: Form = {
  name: '',
  concentration: '',
  formula: '',
  casNo: '',
  grade: '',
  unit: 'mL',
  mainUse: '실험용',
  expiryDate: '',
  purchaseDate: '',
  openedDate: '',
  maker: '',
  supplier: '',
  zoneId: '',
  toxic: '판정 불가',
  accidentPrep: '판정 불가',
  hazardManual: false,
  poison: false,
  banned: false,
  permitted: false,
  restricted: false,
  note: '',
}

const HAZARD_OPTIONS = ['해당', '해당 없음', '판정 불가'].map((v) => ({
  value: v,
  label: v,
}))
const FLAGS = [
  ['poison', '독극물'],
  ['banned', '금지물질'],
  ['permitted', '허가물질'],
  ['restricted', '제한물질'],
] as const

function formOf(r: Reagent): Form {
  return {
    ...EMPTY,
    ...r,
    concentration: r.concentration === null ? '' : String(r.concentration),
  }
}

function inputOf(f: Form): Partial<ReagentInput> {
  const { concentration, ...rest } = f
  const trimmed = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]))
  return {
    ...trimmed,
    concentration: concentration.trim() === '' ? null : Number(concentration),
  } as Partial<ReagentInput>
}

function withJudgment(f: Form): Form {
  if (f.hazardManual) return f
  const c = f.concentration.trim() === '' ? null : Number(f.concentration)
  return { ...f, ...judgeHazard(f.casNo, Number.isFinite(c) ? c : null) }
}

const KIND_LABEL = {
  carry: '이월',
  initial: '기초 재고',
  in: '입고',
  out: '출고',
} as const

/** Rows of one school year: the carry-over (if any) and that year's records with before/after. */
function yearRows(txs: TxRow[], year: number) {
  const { start, end } = schoolYearRange(year)
  const balances = runningBalances(txs)
  const earlier = balances.filter((b) => b.tx.date < start)
  const rows: {
    key: string
    date: string
    kind: keyof typeof KIND_LABEL
    tx?: TxRow
    before: number | null
    after: number
  }[] = []
  if (earlier.length)
    rows.push({
      key: 'carry',
      date: start,
      kind: 'carry',
      before: null,
      after: earlier[earlier.length - 1].after,
    })
  for (const b of balances.filter((x) => x.tx.date >= start && x.tx.date <= end)) {
    rows.push({
      key: b.tx.id,
      date: b.tx.date,
      kind: b.tx.kind,
      tx: b.tx,
      before: b.tx.kind === 'initial' ? null : b.before,
      after: b.after,
    })
  }
  return rows
}

function ReagentForm({
  initial,
  isNew,
  busy,
  onSubmit,
  onUnitChange,
  children,
}: {
  initial: Form
  isNew: boolean
  busy: boolean
  onSubmit: (form: Form) => void
  onUnitChange?: (unit: Form['unit']) => void
  children?: ReactNode
}) {
  const [form, setForm] = useState(initial)
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    if (key === 'unit') onUnitChange?.(value as Form['unit'])
    setForm((f) => (key === 'casNo' || key === 'concentration' ? withJudgment({ ...f, [key]: value }) : { ...f, [key]: value }))
  }
  const casBad = form.casNo.trim() !== '' && !isValidCas(form.casNo.trim())
  const unknown = form.toxic === '판정 불가' || form.accidentPrep === '판정 불가'

  return (
    <form
      className="card reagent-form"
      aria-label="시약 정보"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        onSubmit(form)
      }}
    >
      <div className="form-grid">
        <Field label="약품명" value={form.name} onChange={(e) => set('name', e.target.value)} required maxLength={100} />
        <Field
          label="농도(%)"
          type="number"
          min="0"
          max="100"
          step="any"
          value={form.concentration}
          onChange={(e) => set('concentration', e.target.value)}
          hint="%로 모르면 비워 두고 판정을 직접 고르세요. 비우면 순물질(100%)로 판정합니다."
        />
        <Field label="화학식" value={form.formula} onChange={(e) => set('formula', e.target.value)} maxLength={50} />
        <Field label="CAS No." value={form.casNo} onChange={(e) => set('casNo', e.target.value)} placeholder="7647-01-0" maxLength={20} />
        <SelectField
          label="단위"
          value={form.unit}
          options={[
            { value: 'mL', label: 'mL' },
            { value: 'g', label: 'g' },
          ]}
          onChange={(e) => set('unit', e.target.value as Form['unit'])}
        />
        <SelectField
          label="규격"
          value={form.grade}
          options={[
            { value: '', label: '(없음)' },
            { value: '시약용', label: '시약용' },
            { value: '공업용', label: '공업용' },
          ]}
          onChange={(e) => set('grade', e.target.value as Form['grade'])}
        />
        <Field label="주용도" value={form.mainUse} onChange={(e) => set('mainUse', e.target.value)} maxLength={50} />
        <Field label="유효기간" type="date" value={form.expiryDate} onChange={(e) => set('expiryDate', e.target.value)} />
        <Field label="구입일" type="date" value={form.purchaseDate} onChange={(e) => set('purchaseDate', e.target.value)} />
        <Field label="개봉일" type="date" value={form.openedDate} onChange={(e) => set('openedDate', e.target.value)} />
        <Field label="제조사" value={form.maker} onChange={(e) => set('maker', e.target.value)} maxLength={100} />
        <Field label="구입처" value={form.supplier} onChange={(e) => set('supplier', e.target.value)} maxLength={100} />
      </div>
      {casBad && <p className="error">CAS No. 형식이나 검사 숫자가 맞지 않습니다.</p>}

      <fieldset className="hazard-box">
        <legend>유해화학물질 판정 (경기 부록9 기준농도)</legend>
        <div className="form-grid">
          <SelectField
            label="유독물질"
            value={form.toxic}
            options={HAZARD_OPTIONS}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                toxic: e.target.value as HazardStatus,
                hazardManual: true,
              }))
            }
          />
          <SelectField
            label="사고대비물질"
            value={form.accidentPrep}
            options={HAZARD_OPTIONS}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                accidentPrep: e.target.value as HazardStatus,
                hazardManual: true,
              }))
            }
          />
        </div>
        {form.hazardManual ? (
          <p className="hint">
            직접 고른 판정입니다.{' '}
            <button type="button" onClick={() => setForm((f) => withJudgment({ ...f, hazardManual: false }))}>
              자동 판정으로
            </button>
          </p>
        ) : (
          <p className="hint">CAS No.와 농도로 자동 판정합니다. 바꾸면 직접 고른 판정으로 저장됩니다.</p>
        )}
        {unknown && <p className="hint">기준표에 없는 물질입니다. 화학물질정보처리시스템(kreach.me.go.kr)에서 확인한 뒤 직접 골라 주세요.</p>}
      </fieldset>

      <PlacePicker value={form.zoneId} onChange={(zoneId) => set('zoneId', zoneId)} />

      <fieldset>
        <legend>표시</legend>
        {FLAGS.map(([key, label]) => (
          <label key={key} className="check">
            <input type="checkbox" checked={form[key]} onChange={(e) => set(key, e.target.checked)} /> {label}
          </label>
        ))}
      </fieldset>
      <Field label="비고" value={form.note} onChange={(e) => set('note', e.target.value)} maxLength={500} />
      {children}
      <div className="toolbar">
        <span className="spacer" />
        <button className="primary" type="submit" disabled={busy || casBad}>
          {isNew ? '등록' : '저장'}
        </button>
      </div>
    </form>
  )
}

function NewReagent() {
  const navigate = useNavigate()
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState<Form['unit']>('mL')
  const [date, setDate] = useState(todayKst())
  const [error, setError] = useState<string | null>(null)
  const { busy, run } = useBusy(setError)

  function submit(form: Form) {
    const value = Number(amount)
    if (amount.trim() === '' || !(value >= 0)) {
      setError('기초 재고량을 0 이상의 숫자로 입력해 주세요.')
      return
    }
    run(async () => {
      const created = await reagentsApi.create(inputOf(form), value, date)
      navigate(`/reagents/${created.id}`, { replace: true })
    })
  }

  return (
    <section>
      <div className="toolbar">
        <h1>시약 등록</h1>
        <span className="spacer" />
        <Link to="/reagents">시약 목록</Link>
      </div>
      <ErrorMessage message={error} />
      <ReagentForm initial={EMPTY} isNew busy={busy} onSubmit={submit} onUnitChange={setUnit}>
        <fieldset>
          <legend>기초 재고 (대장의 첫 줄)</legend>
          <div className="form-grid">
            <Field label={`기초 재고량 (${unit})`} type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            <Field label="기준일" type="date" value={date} max={todayKst()} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <button type="button" onClick={() => setDate(schoolYearRange(schoolYearOf(todayKst())).start)}>
            이 학년도 3월 1일
          </button>
          <p className="hint">3월 1일로 두고 종이 대장의 기록을 날짜대로 옮겨 적을 수도 있고, 오늘 남은 양으로 지금부터 시작할 수도 있습니다.</p>
        </fieldset>
      </ReagentForm>
    </section>
  )
}

function ReagentDetail({ id }: { id: string }) {
  const navigate = useNavigate()
  const [reagent, setReagent] = useState<Reagent | null>(null)
  const [txs, setTxs] = useState<TxRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [year, setYear] = useState(schoolYearOf(todayKst()))
  const [dialog, setDialog] = useState<{
    mode: 'in' | 'out'
    tx?: TxRow
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formKey, setFormKey] = useState(0)
  const { busy, run } = useBusy(setError)

  const load = useCallback(async () => {
    const [list, records] = await Promise.all([reagentsApi.list(), reagentsApi.txList({ reagentId: id })])
    setReagent(list.find((r) => r.id === id) ?? null)
    setTxs(records)
    setLoaded(true)
  }, [id])

  useEffect(() => {
    load().catch((err) => setError(errorText(err)))
  }, [load])

  const years = useMemo(() => {
    const first = txs.find((t) => t.kind === 'initial' && !t.deleted)
    const from = first ? schoolYearOf(first.date) : year
    const to = schoolYearOf(todayKst())
    const out: number[] = []
    for (let y = to; y >= Math.min(from, to); y--) out.push(y)
    return out
  }, [txs, year])

  if (!reagent) {
    if (error) return <ErrorMessage message={error} />
    if (loaded)
      return (
        <section className="card">
          <p>시약을 찾을 수 없습니다. 삭제되었거나 주소가 잘못되었습니다.</p>
          <Link to="/reagents">시약 목록으로</Link>
        </section>
      )
    return <p>불러오는 중…</p>
  }

  const current = reagent
  const rows = yearRows(txs, year)

  function save(form: Form) {
    const before = inputOf(formOf(current)) as Record<string, unknown>
    const after = inputOf(form) as Record<string, unknown>
    const changes = Object.fromEntries(Object.entries(after).filter(([k, v]) => before[k] !== v))
    if (!Object.keys(changes).length) return
    run(async () => {
      setReagent(await reagentsApi.update(current.id, changes))
      setFormKey((k) => k + 1)
    })
  }

  function removeTx(tx: TxRow) {
    if (!window.confirm(`${tx.date} ${KIND_LABEL[tx.kind]} ${tx.amount} ${current.unit} 기록을 삭제할까요?\n삭제한 기록은 이력에 남습니다.`)) return
    run(async () => {
      await reagentsApi.txRemove(tx.id)
      await load()
    })
  }

  function removeReagent() {
    if (!window.confirm(`'${reagentLabel(current)}'을(를) 삭제할까요?\n수불 기록은 그대로 남고, 삭제된 시약 보기에서 복구할 수 있습니다.`)) return
    run(async () => {
      await reagentsApi.remove(current.id)
      navigate('/reagents')
    })
  }

  return (
    <section>
      <div className="toolbar">
        <h1>{reagentLabel(current)}</h1>
        <HazardBadges reagent={current} />
        <span className="spacer" />
        <Link to="/reagents">시약 목록</Link>
      </div>
      <ErrorMessage message={error} />
      <div className="card toolbar">
        <strong>
          현재 보유량 {current.stock} {current.unit}
        </strong>
        <span className="spacer" />
        <button type="button" className="primary" onClick={() => setDialog({ mode: 'out' })}>
          사용 기록
        </button>
        <button type="button" onClick={() => setDialog({ mode: 'in' })}>
          입고
        </button>
        <Link className="button" to={`/reagents/ledger?ids=${current.id}`}>
          대장 출력
        </Link>
        <HistoryButton table="Reagents" recordId={current.id} label="이력 보기" />
      </div>

      <div className="toolbar">
        <h2>수불 기록</h2>
        <SelectField
          label="학년도"
          value={String(year)}
          options={years.map((y) => ({
            value: String(y),
            label: `${y}학년도`,
          }))}
          onChange={(e) => setYear(Number(e.target.value))}
        />
      </div>
      <table className="tx-table card" aria-label="수불 기록">
        <thead>
          <tr>
            <th>일자</th>
            <th>구분</th>
            <th>수량</th>
            <th>보유량</th>
            <th>잔량</th>
            <th>용도</th>
            <th>금액(원)</th>
            <th>비고</th>
            <th>기록자</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.date}</td>
              <td>{KIND_LABEL[row.kind]}</td>
              <td className="num">{row.tx && row.kind !== 'initial' ? row.tx.amount : ''}</td>
              <td className="num">{row.before ?? ''}</td>
              <td className="num">{row.after}</td>
              <td>{row.tx?.purpose ?? ''}</td>
              <td className="num">{row.tx?.price != null ? row.tx.price.toLocaleString('ko-KR') : ''}</td>
              <td>{row.tx?.note ?? ''}</td>
              <td>{(row.tx as (TxRow & { createdByName?: string }) | undefined)?.createdByName ?? ''}</td>
              <td className="actions">
                {row.tx && (
                  <button
                    type="button"
                    onClick={() =>
                      setDialog({
                        mode: row.kind === 'out' ? 'out' : 'in',
                        tx: row.tx,
                      })
                    }
                  >
                    고치기
                  </button>
                )}
                {row.tx && row.kind !== 'initial' && (
                  <button type="button" className="danger" onClick={() => removeTx(row.tx!)}>
                    삭제
                  </button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={10} className="hint">
                이 학년도의 기록이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>시약 정보</h2>
      <ReagentForm key={formKey} initial={formOf(current)} isNew={false} busy={busy} onSubmit={save} />
      <div className="toolbar">
        <span className="spacer" />
        <button type="button" className="danger" onClick={removeReagent}>
          시약 삭제
        </button>
      </div>

      {dialog && (
        <TxDialog
          reagent={current}
          mode={dialog.mode}
          tx={dialog.tx}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null)
            await load()
          }}
        />
      )}
    </section>
  )
}

export default function ReagentPage() {
  const { reagentId } = useParams()
  return reagentId ? <ReagentDetail key={reagentId} id={reagentId} /> : <NewReagent />
}
