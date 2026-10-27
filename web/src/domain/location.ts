// Where a reagent is kept: "교실 › 보관장 › 구역" (design M2 8-1, 8-7).
import type { Cabinet, Room, Zone } from '../api/records'

export interface Place {
  zoneId: string
  cabinetId: string
  label: string
}

export function zoneName(zone: Pick<Zone, 'name' | 'row' | 'col'>): string {
  return zone.name || `${zone.row}단 ${zone.col}칸`
}

/** zoneId → place, live rows only, in label order. */
export function buildPlaces(rooms: Room[], cabinets: Cabinet[], zones: Zone[]): Map<string, Place> {
  const roomName = new Map(rooms.filter((r) => !r.deleted).map((r) => [r.id, r.name]))
  const cabinetOf = new Map(cabinets.filter((c) => !c.deleted && roomName.has(c.roomId)).map((c) => [c.id, c]))
  const places = zones
    .filter((z) => !z.deleted && cabinetOf.has(z.cabinetId))
    .map((z) => {
      const cabinet = cabinetOf.get(z.cabinetId)!
      return { zoneId: z.id, cabinetId: cabinet.id, label: `${roomName.get(cabinet.roomId)} › ${cabinet.name} › ${zoneName(z)}` }
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'))
  return new Map(places.map((p) => [p.zoneId, p]))
}

export function reagentLabel(r: { name: string; concentration: number | null }): string {
  return r.concentration === null ? r.name : `${r.name} ${r.concentration}%`
}
