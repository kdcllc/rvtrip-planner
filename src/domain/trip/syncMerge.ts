import type { VersionedTrip } from '../../types/api'
import type { Trip, TripsState } from './types'

export type SyncMergeInput = {
  local: TripsState
  savedTrips: ReadonlyMap<string, Trip>
  versions: Readonly<Record<string, number>>
  pendingDeletes: ReadonlySet<string>
  server: { trips: VersionedTrip[]; currentTripId: string | null }
}

export type SyncMergeResult = {
  state: TripsState
  versions: Record<string, number>
  savedTrips: Map<string, Trip>
  overwritten: string[]
}

export function mergeServerTrips(input: SyncMergeInput): SyncMergeResult {
  const { local, savedTrips, versions, pendingDeletes, server } = input

  const resultTrips: Trip[] = []
  const resultVersions: Record<string, number> = {}
  const resultSaved = new Map<string, Trip>()
  const serverById = new Map<string, VersionedTrip>()

  for (const entry of server.trips) {
    const id = entry.trip.id
    serverById.set(id, entry)
    resultVersions[id] = entry.version
    if (pendingDeletes.has(id)) continue
    resultTrips.push(entry.trip)
    resultSaved.set(id, entry.trip)
  }

  const overwritten: string[] = []
  const noted = new Set<string>()
  const note = (name: string) => {
    if (noted.has(name)) return
    noted.add(name)
    overwritten.push(name)
  }
  const keptLocal: Trip[] = []

  for (const localTrip of local.trips) {
    const id = localTrip.id
    const dirty = localTrip !== savedTrips.get(id)
    const serverEntry = serverById.get(id)
    if (serverEntry) {
      if (dirty && JSON.stringify(localTrip) !== JSON.stringify(serverEntry.trip)) {
        note(localTrip.name)
      }
    } else if (id in versions) {
      if (dirty) note(localTrip.name)
    } else {
      keptLocal.push(localTrip)
    }
  }

  resultTrips.push(...keptLocal)

  const has = (id: string | null): id is string =>
    id !== null && resultTrips.some((t) => t.id === id)
  let currentTripId: string | null = null
  if (has(local.currentTripId)) currentTripId = local.currentTripId
  else if (has(server.currentTripId)) currentTripId = server.currentTripId
  else if (resultTrips.length > 0) currentTripId = resultTrips[0].id

  return {
    state: { trips: resultTrips, currentTripId },
    versions: resultVersions,
    savedTrips: resultSaved,
    overwritten,
  }
}
