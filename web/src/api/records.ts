import type { CabinetType, ZoneRow } from '../domain/storage'
import { callApi } from './client'

/** Columns every stored row has (design 5-4). */
export interface Stamped {
  id: string
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  deleted: boolean
}

export interface Room extends Stamped {
  name: string
  isLab: boolean
  note: string
}

export interface Cabinet extends Stamped {
  roomId: string
  name: string
  type: CabinetType
  locked: boolean
  rows: number
  cols: number
  note: string
}

export type Zone = Stamped & ZoneRow & { id: string }

type Tables = { Rooms: Room; Cabinets: Cabinet; Zones: Zone }
type TableName = keyof Tables

export const records = {
  list<T extends TableName>(table: T, where?: Record<string, unknown>) {
    return callApi<Tables[T][]>('records.list', where ? { table, where } : { table })
  },
  create<T extends TableName>(table: T, values: Record<string, unknown>) {
    return callApi<Tables[T]>('records.create', { table, values })
  },
  createMany<T extends TableName>(table: T, rows: Record<string, unknown>[]) {
    return callApi<Tables[T][]>('records.createMany', { table, rows })
  },
  update<T extends TableName>(table: T, id: string, changes: Record<string, unknown>) {
    return callApi<Tables[T]>('records.update', { table, id, changes })
  },
  remove<T extends TableName>(table: T, id: string) {
    return callApi<Tables[T]>('records.delete', { table, id })
  },
}
