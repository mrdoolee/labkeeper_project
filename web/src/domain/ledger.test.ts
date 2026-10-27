import { describe, expect, test } from 'vitest'
import { firstNegative, ledgerLines, paginate, round3, runningBalances, schoolYearOf, schoolYearRange, sortTx, type TxRow } from './ledger'

let seq = 0
function tx(date: string, kind: TxRow['kind'], amount: number, extra: Partial<TxRow> = {}): TxRow {
  seq++
  return {
    id: `t${seq}`,
    reagentId: 'r1',
    date,
    kind,
    amount,
    purpose: '',
    price: null,
    note: '',
    createdAt: `2026-03-02T09:00:${String(seq % 60).padStart(2, '0')}+09:00`,
    deleted: false,
    ...extra,
  }
}

describe('school year', () => {
  test.each([
    ['2026-03-01', 2026],
    ['2027-02-28', 2026],
    ['2028-02-29', 2027],
    ['2026-02-28', 2025],
  ])('%s belongs to %i', (date, year) => {
    expect(schoolYearOf(date)).toBe(year)
  })

  test('ranges end on the last day of February, leap years included', () => {
    expect(schoolYearRange(2026)).toEqual({ start: '2026-03-01', end: '2027-02-28' })
    expect(schoolYearRange(2027)).toEqual({ start: '2027-03-01', end: '2028-02-29' })
  })
})

test('round3 hides floating point noise', () => {
  expect(round3(0.1 + 0.2)).toBe(0.3)
  expect(round3(2.5)).toBe(2.5)
})

describe('running balance', () => {
  test('before and after amounts in date order', () => {
    const rows = [tx('2026-04-08', 'out', 50), tx('2026-03-01', 'initial', 300), tx('2026-03-16', 'in', 500)]
    expect(runningBalances(rows).map((b) => [b.tx.kind, b.before, b.after])).toEqual([
      ['initial', 0, 300],
      ['in', 300, 800],
      ['out', 800, 750],
    ])
  })

  test('deleted rows are ignored', () => {
    const rows = [tx('2026-03-01', 'initial', 300), tx('2026-03-02', 'out', 100, { deleted: true })]
    expect(runningBalances(rows).map((b) => b.after)).toEqual([300])
  })

  test('same-date rows follow the time they were written; the initial stock comes first', () => {
    const a = tx('2026-03-05', 'out', 10, { createdAt: '2026-03-05T10:00:00+09:00' })
    const b = tx('2026-03-05', 'in', 100, { createdAt: '2026-03-05T09:00:00+09:00' })
    const init = tx('2026-03-05', 'initial', 0, { createdAt: '2026-03-05T11:00:00+09:00' })
    expect(sortTx([a, b, init]).map((t) => t.id)).toEqual([init.id, b.id, a.id])
  })

  test('decimal amounts add up cleanly', () => {
    const rows = [tx('2026-03-01', 'initial', 0), tx('2026-03-02', 'in', 0.1), tx('2026-03-02', 'in', 0.2)]
    expect(runningBalances(rows).at(-1)!.after).toBe(0.3)
  })

  test('firstNegative finds the first record that goes below zero', () => {
    const init = tx('2026-03-01', 'initial', 100)
    const out80 = tx('2026-03-02', 'out', 80)
    expect(firstNegative([init, out80])).toBeNull()
    const backdated = tx('2026-03-01', 'out', 30)
    expect(firstNegative([init, out80, backdated])).toEqual({ tx: out80, after: -10 })
  })
})

describe('ledgerLines', () => {
  const rows = [
    tx('2025-09-01', 'initial', 300),
    tx('2026-03-16', 'in', 500, { purpose: '○○과학', price: 25000 }),
    tx('2026-04-08', 'out', 50, { purpose: '2학년 중화 반응 실험', note: '조별' }),
    tx('2027-03-02', 'out', 10, { purpose: '다음 해' }),
  ]

  test('a year after the initial stock starts with the carry-over', () => {
    expect(ledgerLines(rows, 2026)).toEqual([
      { date: '2026-03-01', kind: 'carry', amount: null, before: null, after: 300, purpose: '', price: null, note: '' },
      { date: '2026-03-16', kind: 'in', amount: 500, before: 300, after: 800, purpose: '○○과학', price: 25000, note: '' },
      { date: '2026-04-08', kind: 'out', amount: 50, before: 800, after: 750, purpose: '2학년 중화 반응 실험', price: null, note: '조별' },
    ])
  })

  test('the year the stock was first entered starts with that line', () => {
    const lines = ledgerLines([tx('2026-03-01', 'initial', 300), tx('2026-03-10', 'out', 20)], 2026)
    expect(lines[0]).toEqual({ date: '2026-03-01', kind: 'initial', amount: null, before: null, after: 300, purpose: '', price: null, note: '' })
    expect(lines).toHaveLength(2)
  })

  test('a year without records but with stock left shows only the carry-over', () => {
    expect(ledgerLines(rows.slice(0, 3), 2027)).toEqual([
      { date: '2027-03-01', kind: 'carry', amount: null, before: null, after: 750, purpose: '', price: null, note: '' },
    ])
  })

  test('a reagent used up before the year and untouched in it has no ledger', () => {
    expect(ledgerLines([tx('2025-09-01', 'initial', 10), tx('2025-10-01', 'out', 10)], 2026)).toEqual([])
  })

  test('a reagent first entered after the year has no ledger for it', () => {
    expect(ledgerLines([tx('2027-04-01', 'initial', 10)], 2026)).toEqual([])
  })
})

describe('paginate', () => {
  test('pads the last page with empty rows', () => {
    expect(paginate([1, 2, 3], 2)).toEqual([
      [1, 2],
      [3, null],
    ])
  })

  test('always gives at least one page', () => {
    expect(paginate([], 2)).toEqual([[null, null]])
  })
})

test('todayKst uses Korean time', async () => {
  const { todayKst } = await import('./ledger')
  expect(todayKst(new Date('2026-10-27T14:59:00Z'))).toBe('2026-10-27')
  expect(todayKst(new Date('2026-10-27T15:00:00Z'))).toBe('2026-10-28')
})
