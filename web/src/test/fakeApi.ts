// In-memory stand-in for the GAS records/directory/audit/reagent actions, for page tests.
import { ApiError } from '../api/client'
import { firstNegative, round3, runningBalances, type TxRow } from '../domain/ledger'

type Row = Record<string, unknown> & { id: string }

export function createFakeApi(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = { Rooms: [], Cabinets: [], Zones: [], Reagents: [], ReagentTx: [], ...structuredClone(seed) }
  let settings: Record<string, unknown> = { region: 'chungbuk', schoolName: '청주중학교' }
  let next = 1
  const calls: { action: string; payload: Record<string, unknown> }[] = []
  // data.go.kr lookups (chem.search / chem.info): set by each test.
  const chem: { items: unknown[]; info: Record<string, unknown>; error: ApiError | null } = { items: [], info: {}, error: null }

  function stamp(values: Record<string, unknown>): Row {
    const n = next++
    const at = `2026-03-02T09:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}+09:00`
    return { id: `id${n}`, ...values, createdBy: 'u1', createdAt: at, updatedBy: 'u1', updatedAt: '2026-03-02T09:00:00.000Z', deleted: false }
  }

  // Same rules as gas/src/Reagents.js: stock = sum of live records, never below zero.
  function txOf(reagentId: string): TxRow[] {
    return tables.ReagentTx.filter((t) => t.reagentId === reagentId) as unknown as TxRow[]
  }
  function restock(reagentId: string, txs: TxRow[], newId?: string): number {
    const neg = firstNegative(txs)
    const reagent = tables.Reagents.find((r) => r.id === reagentId)!
    if (neg) {
      if (neg.tx.id === newId) {
        const before = runningBalances(txs).find((b) => b.tx.id === newId)!.before
        throw new ApiError('INVALID', `남은 양(${before} ${reagent.unit})보다 많습니다.`)
      }
      throw new ApiError('INVALID', `이렇게 바꾸면 ${neg.tx.date}에 남은 양이 음수가 됩니다.`)
    }
    const all = runningBalances(txs)
    return all.length ? all[all.length - 1].after : 0
  }
  function setStock(reagentId: string, stock: number) {
    tables.Reagents.find((r) => r.id === reagentId)!.stock = stock
  }

  async function handle(action: string, payload: object = {}): Promise<unknown> {
    const p = payload as Record<string, unknown>
    calls.push({ action, payload: p })
    const table = tables[p.table as string]
    switch (action) {
      case 'records.list': {
        const where = (p.where ?? {}) as Record<string, unknown>
        return table.filter((r) => (p.includeDeleted || !r.deleted) && Object.entries(where).every(([k, v]) => r[k] === v))
      }
      case 'records.create': {
        const row = stamp(p.values as Record<string, unknown>)
        table.push(row)
        return row
      }
      case 'records.createMany': {
        const rows = (p.rows as Record<string, unknown>[]).map(stamp)
        table.push(...rows)
        return rows
      }
      case 'records.update': {
        const row = table.find((r) => r.id === p.id)!
        Object.assign(row, p.changes)
        return row
      }
      case 'records.delete': {
        const row = table.find((r) => r.id === p.id)!
        row.deleted = true
        return row
      }
      case 'records.deleteMany': {
        const rows = table.filter((r) => (p.ids as string[]).includes(r.id))
        rows.forEach((r) => (r.deleted = true))
        return rows
      }
      case 'records.restore': {
        const row = table.find((r) => r.id === p.id)!
        row.deleted = false
        return row
      }
      case 'reagents.list':
        return tables.Reagents.filter((r) => p.includeDeleted || !r.deleted)
      case 'reagents.create': {
        const reagent = stamp({ ...(p.values as object), stock: round3(p.initialAmount as number) })
        tables.Reagents.push(reagent)
        tables.ReagentTx.push(stamp({ reagentId: reagent.id, date: p.initialDate, kind: 'initial', amount: p.initialAmount, purpose: '', price: null, note: '' }))
        return reagent
      }
      case 'reagents.createMany': {
        const created = (p.rows as { values: object; initialAmount: number; initialDate: string }[]).map((row) => {
          const reagent = stamp({ ...row.values, stock: row.initialAmount })
          tables.Reagents.push(reagent)
          tables.ReagentTx.push(stamp({ reagentId: reagent.id, date: row.initialDate, kind: 'initial', amount: row.initialAmount, purpose: '', price: null, note: '' }))
          return reagent
        })
        return { created, skippedLines: [] }
      }
      case 'reagents.update': {
        const row = tables.Reagents.find((r) => r.id === p.id)!
        Object.assign(row, p.changes)
        return row
      }
      case 'reagents.delete':
      case 'reagents.restore': {
        const row = tables.Reagents.find((r) => r.id === p.id)!
        row.deleted = action === 'reagents.delete'
        return row
      }
      case 'reagentTx.list':
        return tables.ReagentTx.filter(
          (t) =>
            (p.includeDeleted || !t.deleted) &&
            (!p.reagentId || t.reagentId === p.reagentId) &&
            (!p.from || (t.date as string) >= (p.from as string)) &&
            (!p.to || (t.date as string) <= (p.to as string)),
        )
      case 'reagentTx.create': {
        const { reagentId, ...values } = p as { reagentId: string }
        const tx = stamp({ reagentId, purpose: '', price: null, note: '', ...values }) as unknown as TxRow
        const stock = restock(reagentId, [...txOf(reagentId), tx], tx.id)
        tables.ReagentTx.push(tx as unknown as Row)
        setStock(reagentId, stock)
        return { tx, stock }
      }
      case 'reagentTx.update':
      case 'reagentTx.delete':
      case 'reagentTx.restore': {
        const row = tables.ReagentTx.find((t) => t.id === p.id)!
        const changed =
          action === 'reagentTx.update' ? { ...row, ...(p.changes as object) } : { ...row, deleted: action === 'reagentTx.delete' }
        const reagentId = row.reagentId as string
        const stock = restock(reagentId, txOf(reagentId).map((t) => (t.id === row.id ? (changed as unknown as TxRow) : t)))
        Object.assign(row, changed)
        setStock(reagentId, stock)
        return { tx: row, stock }
      }
      case 'reagentTx.recentPurposes':
        return [...new Set(tables.ReagentTx.filter((t) => t.kind === 'out' && !t.deleted).map((t) => t.purpose as string).reverse())].slice(0, 8)
      case 'settings.get':
        return settings
      case 'settings.update':
        settings = { ...settings, ...p }
        return settings
      case 'directory.list':
        return [{ id: 'u1', name: '김운영' }]
      case 'audit.list':
        return []
      case 'chem.search':
        if (chem.error) throw chem.error
        return { items: chem.items }
      case 'chem.info':
        if (chem.error) throw chem.error
        return chem.info[p.casNo as string] ?? { found: false }
      default:
        throw new Error('unexpected action ' + action)
    }
  }

  // hold(action): calls to that action wait until release() is called.
  const held: Record<string, Promise<void> | undefined> = {}
  function hold(action: string) {
    let release!: () => void
    held[action] = new Promise<void>((r) => (release = r))
    return () => {
      delete held[action]
      release()
    }
  }
  async function handleWithHold(action: string, payload: object = {}) {
    if (held[action]) await held[action]
    return handle(action, payload)
  }

  return { tables, calls, chem, hold, handle: handleWithHold, called: (action: string) => calls.filter((c) => c.action === action).map((c) => c.payload) }
}
