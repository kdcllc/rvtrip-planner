import type { Trip, TripsState, TripStop } from '../../domain/trip/types'
import type { ApiResult } from '../../types/auth'
import type {
  DeleteTripResponse,
  GetTripsResponse,
  ImportTripsRequest,
  ImportTripsResponse,
  PutTripRequest,
  PutTripResponse,
  PutTripSelectionRequest,
  PutTripSelectionResponse,
  VersionedTrip,
} from '../../types/api'
import { apiDelete, apiGet, apiPost, apiPut } from '../auth/apiClient'
import { foldLegacyStopFields, type LegacyTripStop } from '../../domain/trip/stopFields'
import { createId } from '../../utils/id'

const LEGACY_TRIPS_KEY = 'trip-planner-trips'
const LEGACY_EXPORT_KEY = 'exported-trips'
const IMPORT_CHUNK_SIZE = 200

type CommonFailure =
  | { kind: 'database-waking'; retryAfterSeconds?: number }
  | { kind: 'session-expired' }

export type LoadTripsResult =
  | { kind: 'loaded'; trips: VersionedTrip[]; currentTripId: string | null }
  | CommonFailure
  | { kind: 'error'; message: string }

export type SaveTripResult =
  | { kind: 'saved'; version: number }
  | { kind: 'conflict'; current: VersionedTrip | null }
  | CommonFailure
  | { kind: 'error'; message: string; retryable: boolean }

export type SimpleSaveResult =
  | { kind: 'saved' }
  | CommonFailure
  | { kind: 'error'; message: string }

export type ImportTripsResult =
  | { kind: 'imported'; imported: string[]; skipped: string[] }
  | CommonFailure
  | { kind: 'error'; message: string }

type Failure = Exclude<ApiResult<unknown>, { kind: 'success' }>

const toCommonFailure = (result: Failure): CommonFailure | null => {
  if (result.kind === 'database-waking') {
    return result.retryAfterSeconds === undefined
      ? { kind: 'database-waking' }
      : { kind: 'database-waking', retryAfterSeconds: result.retryAfterSeconds }
  }
  if (result.kind === 'auth-failure') return { kind: 'session-expired' }
  return null
}

const toMessage = (result: Failure): string =>
  result.kind === 'database-waking' ? 'Database is waking up' : result.error

const foldTripStops = (trip: Trip): Trip => ({
  ...trip,
  stops: Array.isArray(trip.stops)
    ? trip.stops.map((stop) => foldLegacyStopFields(stop as LegacyTripStop))
    : trip.stops,
})

/** Load all trips for the signed-in user (GET /api/trips). */
export async function loadTrips(): Promise<LoadTripsResult> {
  const result = await apiGet<GetTripsResponse>('/api/trips')
  if (result.kind !== 'success') {
    return toCommonFailure(result) ?? { kind: 'error', message: toMessage(result) }
  }
  const data = result.data
  if (!data || !Array.isArray(data.trips)) {
    return { kind: 'error', message: 'Invalid trips response' }
  }
  return { kind: 'loaded', trips: data.trips.map((entry) => ({ ...entry, trip: foldTripStops(entry.trip) })), currentTripId: data.currentTripId ?? null }
}

const isConflictCurrent = (value: unknown): VersionedTrip | null =>
  value && typeof value === 'object' && 'trip' in value && 'version' in value
    ? (value as VersionedTrip)
    : null

/** Save one trip (PUT /api/trips/{id}); baseVersion null creates. Never throws. */
export async function saveTrip(trip: Trip, baseVersion: number | null): Promise<SaveTripResult> {
  try {
    const body: PutTripRequest = { trip, baseVersion }
    const result = await apiPut<PutTripResponse>(`/api/trips/${encodeURIComponent(trip.id)}`, body)
    if (result.kind === 'success') return { kind: 'saved', version: result.data.version }
    if (result.kind === 'validation-failure' && result.status === 409) {
      const current = (result as { current?: unknown }).current
      const parsed = isConflictCurrent(current)
      return {
        kind: 'conflict',
        current: parsed ? { ...parsed, trip: foldTripStops(parsed.trip) } : null,
      }
    }
    const common = toCommonFailure(result)
    if (common) return common
    // Network failure (status 0) and 5xx are retryable; other 4xx are not.
    const retryable = result.kind === 'error' && (result.status === 0 || result.status >= 500)
    return { kind: 'error', message: toMessage(result), retryable }
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : 'Save failed', retryable: true }
  }
}

const simple = (result: ApiResult<unknown>): SimpleSaveResult => {
  if (result.kind === 'success') return { kind: 'saved' }
  return toCommonFailure(result) ?? { kind: 'error', message: toMessage(result) }
}

/** Delete one trip (DELETE /api/trips/{id}). */
export async function deleteTrip(tripId: string): Promise<SimpleSaveResult> {
  return simple(await apiDelete<DeleteTripResponse>(`/api/trips/${encodeURIComponent(tripId)}`))
}

/** Persist the current-trip selection (PUT /api/trip-selection). */
export async function saveTripSelection(currentTripId: string | null): Promise<SimpleSaveResult> {
  const body: PutTripSelectionRequest = { currentTripId }
  return simple(await apiPut<PutTripSelectionResponse>('/api/trip-selection', body))
}

/** Import trips (POST /api/trips/import) in chunks of at most 200; results are merged. */
export async function importTrips(trips: Trip[]): Promise<ImportTripsResult> {
  const imported: string[] = []
  const skipped: string[] = []
  for (let i = 0; i < trips.length; i += IMPORT_CHUNK_SIZE) {
    const body: ImportTripsRequest = { trips: trips.slice(i, i + IMPORT_CHUNK_SIZE) }
    const result = await apiPost<ImportTripsResponse>('/api/trips/import', body)
    if (result.kind !== 'success') {
      return toCommonFailure(result) ?? { kind: 'error', message: toMessage(result) }
    }
    imported.push(...result.data.imported)
    skipped.push(...result.data.skipped)
  }
  return { kind: 'imported', imported, skipped }
}

/**
 * LEGACY IMPORT ONLY (first-login legacy import). Reads the old localStorage keys
 * (`trip-planner-trips`, `exported-trips`) and returns a TripsState, or null when none.
 * Not a fallback for normal operation.
 */
export function readLegacyLocalTrips(): TripsState | null {
  try {
    const stored = window.localStorage.getItem(LEGACY_TRIPS_KEY)
    if (stored) {
      const state = JSON.parse(stored) as TripsState
      if (!state.currentTripId && state.trips.length > 0) {
        state.currentTripId = state.trips[0].id
      }
      return { ...state, trips: state.trips.map(foldTripStops) }
    }
    const legacy = window.localStorage.getItem(LEGACY_EXPORT_KEY)
    if (legacy) {
      const parsed = JSON.parse(legacy) as { version: string; trips: TripStop[] }
      if (parsed.trips && Array.isArray(parsed.trips)) {
        const now = new Date().toISOString()
        const newTrip: Trip = {
          id: createId(),
          name: 'Imported Trip',
          stops: parsed.trips.map((stop) => foldLegacyStopFields(stop as LegacyTripStop)),
          createdAt: now,
          updatedAt: now,
        }
        return { trips: [newTrip], currentTripId: newTrip.id }
      }
    }
  } catch (error) {
    console.error('Error reading legacy local trips:', error)
  }
  return null
}

/** LEGACY IMPORT ONLY (first-login legacy import): removes the old localStorage trip keys after a successful import. */
export function clearLegacyLocalTrips(): void {
  try {
    window.localStorage.removeItem(LEGACY_TRIPS_KEY)
    window.localStorage.removeItem(LEGACY_EXPORT_KEY)
  } catch (error) {
    console.error('Error clearing legacy local trips:', error)
  }
}

/**
 * Create a new trip
 */
export function createNewTrip(name: string): Trip {
  const id = createId()
  return {
    id,
    name: name.trim() || 'Untitled Trip',
    stops: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Get the current trip from state
 */
export function getCurrentTrip(state: TripsState): Trip | null {
  if (!state.currentTripId) return null
  return state.trips.find((trip) => trip.id === state.currentTripId) || null
}

/**
 * Get all trip names sorted by most recent first
 */
export function getTripsSortedByRecent(trips: Trip[]): Trip[] {
  return [...trips].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
}
