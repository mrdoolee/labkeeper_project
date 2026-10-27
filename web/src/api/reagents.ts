// Reagent and in/out record actions (gas/src/Reagents.js).
import type { HazardStatus } from '../domain/hazard'
import type { TxKind, TxRow } from '../domain/ledger'
import { callApi } from './client'
import type { Stamped } from './records'

export interface Reagent extends Stamped {
  name: string
  concentration: number | null
  formula: string
  casNo: string
  grade: '' | '시약용' | '공업용'
  unit: 'mL' | 'g'
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
  stock: number
  note: string
}

/** Fields a person fills in (stock is kept by the server). */
export type ReagentInput = Omit<Reagent, keyof Stamped | 'stock'>

export interface TxInput {
  reagentId: string
  date: string
  kind: Exclude<TxKind, 'initial'>
  amount: number
  purpose: string
  price?: number | null
  note?: string
}

export interface ImportRow {
  line: number
  values: Partial<ReagentInput>
  initialAmount: number
  initialDate: string
}

type TxResult = { tx: TxRow; stock: number }

export const reagentsApi = {
  list: (includeDeleted = false) => callApi<Reagent[]>('reagents.list', includeDeleted ? { includeDeleted } : {}),
  create: (values: Partial<ReagentInput>, initialAmount: number, initialDate: string) =>
    callApi<Reagent>('reagents.create', { values, initialAmount, initialDate }),
  createMany: (rows: ImportRow[]) => callApi<{ created: Reagent[]; skippedLines: number[] }>('reagents.createMany', { rows }),
  update: (id: string, changes: Partial<ReagentInput>) => callApi<Reagent>('reagents.update', { id, changes }),
  remove: (id: string) => callApi<Reagent>('reagents.delete', { id }),
  restore: (id: string) => callApi<Reagent>('reagents.restore', { id }),
  txList: (q: { reagentId?: string; from?: string; to?: string; includeDeleted?: boolean }) => callApi<TxRow[]>('reagentTx.list', q),
  txCreate: (v: TxInput) => callApi<TxResult>('reagentTx.create', v),
  txUpdate: (id: string, changes: Partial<Pick<TxRow, 'date' | 'amount' | 'purpose' | 'price' | 'note'>>) =>
    callApi<TxResult>('reagentTx.update', { id, changes }),
  txRemove: (id: string) => callApi<TxResult>('reagentTx.delete', { id }),
  txRestore: (id: string) => callApi<TxResult>('reagentTx.restore', { id }),
  recentPurposes: () => callApi<string[]>('reagentTx.recentPurposes', {}),
}
