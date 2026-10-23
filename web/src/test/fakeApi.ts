// In-memory stand-in for the GAS records/directory/audit actions, for page tests.
type Row = Record<string, unknown> & { id: string }

export function createFakeApi(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = { Rooms: [], Cabinets: [], Zones: [], ...structuredClone(seed) }
  let next = 1
  const calls: { action: string; payload: Record<string, unknown> }[] = []

  function stamp(values: Record<string, unknown>): Row {
    return { id: `id${next++}`, ...values, createdBy: 'u1', updatedBy: 'u1', updatedAt: '2026-03-02T09:00:00.000Z', deleted: false }
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
      case 'directory.list':
        return [{ id: 'u1', name: '김운영' }]
      case 'audit.list':
        return []
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

  return { tables, calls, hold, handle: handleWithHold, called: (action: string) => calls.filter((c) => c.action === action).map((c) => c.payload) }
}
