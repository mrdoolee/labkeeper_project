import { useEffect, useState } from 'react'
import { records } from '../api/records'
import { buildPlaces, type Place } from '../domain/location'

/** The school's places (교실 › 보관장 › 구역), loaded once. */
export function usePlaces(): Map<string, Place> {
  const [places, setPlaces] = useState<Map<string, Place>>(new Map())
  useEffect(() => {
    Promise.all([records.list('Rooms'), records.list('Cabinets'), records.list('Zones')])
      .then(([rooms, cabinets, zones]) => setPlaces(buildPlaces(rooms, cabinets, zones)))
      .catch(() => setPlaces(new Map()))
  }, [])
  return places
}
