import type { Trip, TripsState, TripStop } from '../../domain/trip/types'
import type { ApiResult } from '../../types/auth'
import { apiGet, apiPut } from '../auth/apiClient'
import { createId } from '../../utils/id'

const LEGACY_TRIPS_KEY = 'trip-planner-trips'
const LEGACY_EXPORT_KEY = 'exported-trips'

/** Typed outcome of a trips load. There is no local fallback: failures are surfaced. */
export type LoadTripsResult =
  | { kind: 'loaded'; state: TripsState; isNew: boolean }
  | { kind: 'database-waking'; retryAfterSeconds?: number }
  | { kind: 'session-expired' }
  | { kind: 'error'; message: string }

/** Typed outcome of a trips save. A failed save never throws; the caller keeps its state. */
export type SaveTripsResult =
  | { kind: 'saved' }
  | { kind: 'database-waking'; retryAfterSeconds?: number }
  | { kind: 'session-expired' }
  | { kind: 'error'; message: string }

type Failure = Exclude<ApiResult<unknown>, { kind: 'success' }>

const toFailure = (
  result: Failure
):
  | { kind: 'database-waking'; retryAfterSeconds?: number }
  | { kind: 'session-expired' }
  | { kind: 'error'; message: string } => {
  if (result.kind === 'database-waking') {
    return result.retryAfterSeconds === undefined
      ? { kind: 'database-waking' }
      : { kind: 'database-waking', retryAfterSeconds: result.retryAfterSeconds }
  }
  if (result.kind === 'auth-failure') return { kind: 'session-expired' }
  return { kind: 'error', message: result.error }
}

const makeDefaultState = (): TripsState => {
  const now = new Date().toISOString()
  const trip: Trip = { id: createId(), name: 'My First Trip', stops: [], createdAt: now, updatedAt: now }
  return { trips: [trip], currentTripId: trip.id }
}

/** Load trips from the server (GET /api/trips). */
export async function loadTripsFromStorage(): Promise<LoadTripsResult> {
  const result = await apiGet<TripsState>('/api/trips')
  if (result.kind !== 'success') return toFailure(result)
  const data = result.data
  if (!data || !Array.isArray(data.trips)) {
    return { kind: 'error', message: 'Invalid trips response' }
  }
  // Default trip only for a genuinely empty server state.
  if (data.trips.length === 0) {
    return { kind: 'loaded', state: makeDefaultState(), isNew: true }
  }
  const state: TripsState = { trips: data.trips, currentTripId: data.currentTripId ?? null }
  if (!state.currentTripId) state.currentTripId = state.trips[0].id
  return { kind: 'loaded', state, isNew: false }
}

let inFlight: Promise<SaveTripsResult> | null = null
let pending: { state: TripsState; waiters: Array<(r: SaveTripsResult) => void> } | null = null

const putState = async (state: TripsState): Promise<SaveTripsResult> => {
  try {
    const result = await apiPut<{ ok: true }>('/api/trips', state)
    return result.kind === 'success' ? { kind: 'saved' } : toFailure(result)
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : 'Save failed' }
  }
}

const drain = async (first: TripsState): Promise<SaveTripsResult> => {
  let result = await putState(first)
  while (pending) {
    const batch = pending
    pending = null
    result = await putState(batch.state)
    batch.waiters.forEach((resolve) => resolve(result))
  }
  inFlight = null
  return result
}

/**
 * Save trips to the server (PUT /api/trips). Last-write-wins: while a save is in flight,
 * later calls coalesce so only the newest state is sent next. Never throws.
 */
export function saveTripsToStorage(state: TripsState): Promise<SaveTripsResult> {
  if (!inFlight) {
    inFlight = drain(state)
    return inFlight
  }
  return new Promise<SaveTripsResult>((resolve) => {
    if (pending) {
      pending.state = state
      pending.waiters.push(resolve)
    } else {
      pending = { state, waiters: [resolve] }
    }
  })
}

/**
 * LEGACY IMPORT ONLY (task 13 first-login import). Reads the old localStorage keys
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
      return state
    }
    const legacy = window.localStorage.getItem(LEGACY_EXPORT_KEY)
    if (legacy) {
      const parsed = JSON.parse(legacy) as { version: string; trips: TripStop[] }
      if (parsed.trips && Array.isArray(parsed.trips)) {
        const now = new Date().toISOString()
        const newTrip: Trip = {
          id: createId(),
          name: 'Imported Trip',
          stops: parsed.trips,
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

/** LEGACY IMPORT ONLY (task 13): removes the old localStorage trip keys after a successful import. */
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

/**
 * Update the updatedAt timestamp for a trip
 */
export function updateTripTimestamp(trip: Trip): Trip {
  return {
    ...trip,
    updatedAt: new Date().toISOString(),
  }
}
