import { expect, test } from 'vitest'
import type { Cabinet, Room, Zone } from '../api/records'
import { buildPlaces, reagentLabel } from './location'

const stamp = { createdBy: 'u1', createdAt: '', updatedBy: 'u1', updatedAt: '', deletedBy: '', deletedAt: '', deleted: false }
const rooms = [{ id: 'r1', name: '제1과학실', isLab: true, note: '', ...stamp }] as Room[]
const cabinets = [{ id: 'c1', roomId: 'r1', name: 'A 시약장', type: 'sealed', locked: true, rows: 2, cols: 2, note: '', ...stamp }] as Cabinet[]
const zones = [
  { id: 'z1', cabinetId: 'c1', row: 1, col: 1, name: '진한 산', allowedClasses: '', ...stamp },
  { id: 'z2', cabinetId: 'c1', row: 3, col: 2, name: '', allowedClasses: '', ...stamp },
  { id: 'z3', cabinetId: 'c1', row: 2, col: 2, name: '버린 칸', allowedClasses: '', ...stamp, deleted: true },
] as Zone[]

test('a place reads 교실 › 보관장 › 구역, with 단·칸 when the zone has no name', () => {
  const places = buildPlaces(rooms, cabinets, zones)
  expect(places.get('z1')).toEqual({ zoneId: 'z1', cabinetId: 'c1', label: '제1과학실 › A 시약장 › 진한 산' })
  expect(places.get('z2')!.label).toBe('제1과학실 › A 시약장 › 3단 2칸')
})

test('deleted zones, cabinets and rooms are left out', () => {
  expect(buildPlaces(rooms, cabinets, zones).has('z3')).toBe(false)
  expect(buildPlaces(rooms, [{ ...cabinets[0], deleted: true }], zones).size).toBe(0)
  expect(buildPlaces([{ ...rooms[0], deleted: true }], cabinets, zones).size).toBe(0)
})

test('places are sorted by label', () => {
  expect([...buildPlaces(rooms, cabinets, zones).values()].map((p) => p.zoneId)).toEqual(['z2', 'z1'])
})

test('reagentLabel adds the concentration when there is one', () => {
  expect(reagentLabel({ name: '염화 수소(염산)', concentration: 35 })).toBe('염화 수소(염산) 35%')
  expect(reagentLabel({ name: '황산 구리(Ⅱ)', concentration: null })).toBe('황산 구리(Ⅱ)')
})
