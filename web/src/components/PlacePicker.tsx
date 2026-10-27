import { useEffect, useMemo, useState } from 'react'
import { records, type Cabinet, type Room, type Zone } from '../api/records'
import { zoneName } from '../domain/location'
import { SelectField } from './Field'

/** 보관 위치: 교실 → 보관장 → 구역. An empty zone means 위치 미지정. */
export function PlacePicker({ value, onChange }: { value: string; onChange: (zoneId: string) => void }) {
  const [rooms, setRooms] = useState<Room[]>([])
  const [cabinets, setCabinets] = useState<Cabinet[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [roomId, setRoomId] = useState('')
  const [cabinetId, setCabinetId] = useState('')

  useEffect(() => {
    Promise.all([records.list('Rooms'), records.list('Cabinets'), records.list('Zones')])
      .then(([r, c, z]) => {
        setRooms(r)
        setCabinets(c)
        setZones(z)
      })
      .catch(() => {})
  }, [])

  // Start from the stored zone once the lists are in.
  const zone = zones.find((z) => z.id === value)
  const cabinetShown = cabinetId || zone?.cabinetId || ''
  const roomShown = roomId || cabinets.find((c) => c.id === cabinetShown)?.roomId || ''

  const cabinetOptions = useMemo(() => cabinets.filter((c) => !roomShown || c.roomId === roomShown), [cabinets, roomShown])
  const zoneOptions = useMemo(() => zones.filter((z) => z.cabinetId === cabinetShown).sort((a, b) => a.row - b.row || a.col - b.col), [zones, cabinetShown])

  return (
    <fieldset className="place-picker">
      <legend>보관 위치</legend>
      <SelectField
        label="교실"
        value={roomShown}
        options={[{ value: '', label: '(전체)' }, ...rooms.map((r) => ({ value: r.id, label: r.name }))]}
        onChange={(e) => {
          setRoomId(e.target.value)
          setCabinetId('')
          onChange('')
        }}
      />
      <SelectField
        label="보관장"
        value={cabinetShown}
        options={[{ value: '', label: '(선택)' }, ...cabinetOptions.map((c) => ({ value: c.id, label: c.name }))]}
        onChange={(e) => {
          const next = cabinets.find((c) => c.id === e.target.value)
          setCabinetId(e.target.value)
          if (next) setRoomId(next.roomId)
          onChange('')
        }}
      />
      <SelectField
        label="구역"
        value={value}
        options={[{ value: '', label: '위치 미지정' }, ...zoneOptions.map((z) => ({ value: z.id, label: zoneName(z) }))]}
        onChange={(e) => onChange(e.target.value)}
      />
    </fieldset>
  )
}
