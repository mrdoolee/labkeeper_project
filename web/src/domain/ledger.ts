// 시약 수불 기록 → 화학약품 관리대장 줄 (설계 M2 8-6).
// runningBalances의 정렬·계산 규칙은 gas/src/Reagents.js의 txBalances와 같다. 바꿀 때 함께 바꾼다.

export type TxKind = 'initial' | 'in' | 'out'

export interface TxRow {
  id: string
  reagentId: string
  date: string
  kind: TxKind
  amount: number
  purpose: string
  price: number | null
  note: string
  createdAt: string
  deleted: boolean
}

export type LedgerLineKind = 'carry' | 'initial' | 'in' | 'out'

export interface LedgerLine {
  date: string
  kind: LedgerLineKind
  amount: number | null
  before: number | null
  after: number
  purpose: string
  price: number | null
  note: string
}

export function round3(x: number): number {
  return Math.round(x * 1000) / 1000
}

/** 한국 시간 기준 오늘 (YYYY-MM-DD). */
export function todayKst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now)
}

/** 학년도: 3월 1일 ~ 이듬해 2월 말일. */
export function schoolYearOf(date: string): number {
  const year = Number(date.slice(0, 4))
  return Number(date.slice(5, 7)) >= 3 ? year : year - 1
}

export function schoolYearRange(year: number): { start: string; end: string } {
  const next = year + 1
  const leap = (next % 4 === 0 && next % 100 !== 0) || next % 400 === 0
  return { start: `${year}-03-01`, end: `${next}-02-${leap ? 29 : 28}` }
}

/** 살아 있는 기록만, 날짜 → 기초 재고 먼저 → 작성 시각 → id 순. */
export function sortTx(txs: TxRow[]): TxRow[] {
  return txs
    .filter((t) => !t.deleted)
    .slice()
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        Number(b.kind === 'initial') - Number(a.kind === 'initial') ||
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        a.id.localeCompare(b.id),
    )
}

export function runningBalances(txs: TxRow[]): { tx: TxRow; before: number; after: number }[] {
  let balance = 0
  return sortTx(txs).map((tx) => {
    const before = balance
    balance = round3(tx.kind === 'out' ? balance - tx.amount : balance + tx.amount)
    return { tx, before, after: balance }
  })
}

export function firstNegative(txs: TxRow[]): { tx: TxRow; after: number } | null {
  const found = runningBalances(txs).find((b) => b.after < 0)
  return found ? { tx: found.tx, after: found.after } : null
}

/** 그 학년도 대장의 줄. 그 해에 기록도 없고 이월 잔량도 없으면 빈 배열. */
export function ledgerLines(txs: TxRow[], year: number): LedgerLine[] {
  const { start, end } = schoolYearRange(year)
  const balances = runningBalances(txs)
  const earlier = balances.filter((b) => b.tx.date < start)
  const within = balances.filter((b) => b.tx.date >= start && b.tx.date <= end)
  const carry = earlier.length ? earlier[earlier.length - 1].after : null
  if (!within.length && !carry) return []

  const lines: LedgerLine[] = []
  if (carry !== null) lines.push({ date: start, kind: 'carry', amount: null, before: null, after: carry, purpose: '', price: null, note: '' })
  for (const { tx, before, after } of within) {
    if (tx.kind === 'initial') {
      lines.push({ date: tx.date, kind: 'initial', amount: null, before: null, after, purpose: '', price: null, note: tx.note })
    } else {
      lines.push({ date: tx.date, kind: tx.kind, amount: tx.amount, before, after, purpose: tx.purpose, price: tx.kind === 'in' ? tx.price : null, note: tx.note })
    }
  }
  return lines
}

/** 줄을 쪽으로 나눈다. 마지막 쪽은 빈 줄(null)로 채운다. */
export function paginate<T>(lines: T[], perPage: number): (T | null)[][] {
  const pages: (T | null)[][] = []
  for (let i = 0; i < Math.max(lines.length, 1); i += perPage) {
    const page: (T | null)[] = lines.slice(i, i + perPage)
    while (page.length < perPage) page.push(null)
    pages.push(page)
  }
  return pages
}
