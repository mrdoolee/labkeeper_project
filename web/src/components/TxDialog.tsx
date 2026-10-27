import { useEffect, useId, useState, type FormEvent } from 'react'
import { reagentsApi, type Reagent } from '../api/reagents'
import { round3, todayKst, type TxRow } from '../domain/ledger'
import { reagentLabel } from '../domain/location'
import { ErrorMessage, Field } from './Field'
import { useBusy } from './useBusy'

/**
 * 사용 기록(출고) · 입고 창. With `tx` it edits that record instead of adding one.
 * The server checks the balance again; its message is shown here (design M2 8-2, 8-3).
 */
export function TxDialog({
  reagent,
  mode,
  tx,
  onClose,
  onSaved,
}: {
  reagent: Reagent
  mode: 'in' | 'out'
  tx?: TxRow
  onClose: () => void
  onSaved: (stock: number) => void
}) {
  const titleId = useId()
  const isOut = mode === 'out'
  const [date, setDate] = useState(tx?.date ?? todayKst())
  const [amount, setAmount] = useState(tx ? String(tx.amount) : '')
  const [purpose, setPurpose] = useState(tx?.purpose ?? (isOut ? '' : reagent.supplier))
  const [price, setPrice] = useState(tx?.price != null ? String(tx.price) : '')
  const [note, setNote] = useState(tx?.note ?? '')
  const [recent, setRecent] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const { busy, run } = useBusy(setError)

  useEffect(() => {
    if (isOut) reagentsApi.recentPurposes().then(setRecent).catch(() => setRecent([]))
  }, [isOut])

  const value = Number(amount)
  const valid = amount.trim() !== '' && Number.isFinite(value) && value > 0
  // What this record did before the edit, taken out of the current stock.
  const base = tx ? round3(reagent.stock - (tx.kind === 'out' ? -tx.amount : tx.amount)) : reagent.stock
  const after = valid ? round3(isOut ? base - value : base + value) : null
  const tooMuch = after !== null && after < 0
  const title = `${isOut ? '사용 기록' : '입고'}${tx ? ' 고치기' : ''} – ${reagentLabel(reagent)}`

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!valid || tooMuch) return
    const fields = { date, amount: value, purpose: purpose.trim(), note: note.trim(), ...(isOut ? {} : { price: price.trim() === '' ? null : Number(price) }) }
    await run(async () => {
      const res = tx ? await reagentsApi.txUpdate(tx.id, fields) : await reagentsApi.txCreate({ reagentId: reagent.id, kind: mode, ...fields })
      onSaved(res.stock)
    })
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="dialog card tx-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2 id={titleId}>{title}</h2>
        <p className="meta">
          지금 {base} {reagent.unit}
        </p>
        <ErrorMessage message={error} />
        <Field label="일자" type="date" value={date} max={todayKst()} onChange={(e) => setDate(e.target.value)} required />
        <Field
          label={`${isOut ? '사용량' : '입고량'} (${reagent.unit})`}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          autoFocus
        />
        {after !== null && !tooMuch && (
          <p className="tx-after">
            기록 후 남는 양 {after} {reagent.unit}
          </p>
        )}
        {tooMuch && <p className="error">남은 양보다 많습니다.</p>}
        <Field label={isOut ? '용도' : '구입처'} value={purpose} onChange={(e) => setPurpose(e.target.value)} required={isOut} maxLength={200} />
        {isOut && recent.length > 0 && (
          <div className="chips" aria-label="최근 용도">
            {recent.map((p) => (
              <button key={p} type="button" className="chip" onClick={() => setPurpose(p)}>
                {p}
              </button>
            ))}
          </div>
        )}
        {!isOut && <Field label="금액(원, 선택)" type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />}
        <Field label="비고" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        <div className="toolbar">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button className="primary" type="submit" disabled={busy || !valid || tooMuch}>
            저장
          </button>
        </div>
      </form>
    </div>
  )
}
