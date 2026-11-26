import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../auth/apiClient', () => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}))

import { apiDelete, apiGet, apiPost, apiPut } from '../auth/apiClient'
import {
  clearLegacyLocalTrips,
  createNewTrip,
  deleteTrip,
  getCurrentTrip,
  getTripsSortedByRecent,
  importTrips,
  loadTrips,
  readLegacyLocalTrips,
  saveTrip,
  saveTripSelection,
} from './tripStorage'
import type { Trip } from '../../domain/trip/types'

const get = vi.mocked(apiGet)
const put = vi.mocked(apiPut)
const post = vi.mocked(apiPost)
const del = vi.mocked(apiDelete)

const trip = (id: string, updatedAt = '2024-01-01T00:00:00.000Z'): Trip => ({
  id,
  name: id,
  stops: [],
  createdAt: updatedAt,
  updatedAt,
})

const ok = <T,>(data: T) => ({ kind: 'success' as const, status: 200, data })
const waking = { kind: 'database-waking' as const, status: 503 as const, retryAfterSeconds: 4 }
const authFail = { kind: 'auth-failure' as const, status: 401, error: 'no' }

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

describe('loadTrips', () => {
  it('GETs /api/trips and returns versioned trips', async () => {
    get.mockResolvedValue(ok({ trips: [{ trip: trip('a'), version: 2 }], currentTripId: 'a' }))
    const r = await loadTrips()
    expect(get).toHaveBeenCalledWith('/api/trips')
    expect(r).toEqual({ kind: 'loaded', trips: [{ trip: trip('a'), version: 2 }], currentTripId: 'a' })
  })

  it('returns an empty loaded state without fabricating a trip', async () => {
    get.mockResolvedValue(ok({ trips: [], currentTripId: null }))
    expect(await loadTrips()).toEqual({ kind: 'loaded', trips: [], currentTripId: null })
  })

  it('folds legacy stop fields into the merged shape', async () => {
    const legacy = {
      ...trip('a'),
      stops: [{ id: 's', label: 'S', address: 'X', startDate: '', endDate: '', reservationNote: 'Call ahead', source: { name: 'Other', fees: '$30', amenities: 'Wifi' } }],
    }
    get.mockResolvedValue(ok({ trips: [{ trip: legacy, version: 3 }], currentTripId: 'a' }))
    const r = await loadTrips()
    if (r.kind !== 'loaded') throw new Error('expected loaded')
    const stop = r.trips[0].trip.stops[0]
    expect(r.trips[0].version).toBe(3)
    expect(stop).not.toHaveProperty('reservationNote')
    expect(stop.source).toEqual({ name: 'Other' })
    expect(stop.nightlyCost).toBe(30)
    expect(stop.note).toBe('Amenities: Wifi\nReservation: Call ahead')
  })

  it('maps 503, 401, errors and malformed bodies', async () => {
    get.mockResolvedValue(waking)
    expect(await loadTrips()).toEqual({ kind: 'database-waking', retryAfterSeconds: 4 })
    get.mockResolvedValue(authFail)
    expect(await loadTrips()).toEqual({ kind: 'session-expired' })
    get.mockResolvedValue({ kind: 'error', status: 500, error: 'boom' })
    expect(await loadTrips()).toEqual({ kind: 'error', message: 'boom' })
    get.mockResolvedValue(ok({}))
    expect(await loadTrips()).toEqual({ kind: 'error', message: 'Invalid trips response' })
  })
})

describe('saveTrip', () => {
  it('PUTs /api/trips/{id} with trip and baseVersion', async () => {
    put.mockResolvedValue(ok({ version: 3 }))
    const t = trip('a b')
    expect(await saveTrip(t, 2)).toEqual({ kind: 'saved', version: 3 })
    expect(put).toHaveBeenCalledWith('/api/trips/a%20b', { trip: t, baseVersion: 2 })
  })

  it('sends baseVersion null on create', async () => {
    put.mockResolvedValue(ok({ version: 1 }))
    await saveTrip(trip('a'), null)
    expect(put).toHaveBeenCalledWith('/api/trips/a', { trip: trip('a'), baseVersion: null })
  })

  it('returns conflict with the current server record', async () => {
    const current = { trip: trip('a'), version: 5 }
    put.mockResolvedValue({ kind: 'validation-failure', status: 409, error: 'x', code: 'VERSION_CONFLICT', current } as never)
    expect(await saveTrip(trip('a'), 2)).toEqual({ kind: 'conflict', current })
  })

  it('folds legacy stop fields in the conflict current trip', async () => {
    const legacy = {
      ...trip('a'),
      stops: [{ id: 's', label: 'S', address: 'X', startDate: '', endDate: '', reservationNote: 'Call ahead', source: { name: 'Other', fees: '$30', amenities: 'Wifi' } }],
    }
    put.mockResolvedValue({ kind: 'validation-failure', status: 409, error: 'x', current: { trip: legacy, version: 5 } } as never)
    const r = await saveTrip(trip('a'), 2)
    if (r.kind !== 'conflict' || !r.current) throw new Error('expected conflict')
    const stop = r.current.trip.stops[0]
    expect(r.current.version).toBe(5)
    expect(stop).not.toHaveProperty('reservationNote')
    expect(stop.source).toEqual({ name: 'Other' })
    expect(stop.nightlyCost).toBe(30)
    expect(stop.note).toBe('Amenities: Wifi\nReservation: Call ahead')
  })

  it('returns conflict with null current when the server omits it', async () => {
    put.mockResolvedValue({ kind: 'validation-failure', status: 409, error: 'x' })
    expect(await saveTrip(trip('a'), 2)).toEqual({ kind: 'conflict', current: null })
  })

  it('maps session-expired and database-waking', async () => {
    put.mockResolvedValue(authFail)
    expect(await saveTrip(trip('a'), 1)).toEqual({ kind: 'session-expired' })
    put.mockResolvedValue(waking)
    expect(await saveTrip(trip('a'), 1)).toEqual({ kind: 'database-waking', retryAfterSeconds: 4 })
  })

  it('network failure is retryable, 400 is not, 5xx is retryable', async () => {
    put.mockResolvedValue({ kind: 'error', status: 0, error: 'Network error' })
    expect(await saveTrip(trip('a'), 1)).toEqual({ kind: 'error', message: 'Network error', retryable: true })
    put.mockResolvedValue({ kind: 'validation-failure', status: 400, error: 'bad' })
    expect(await saveTrip(trip('a'), 1)).toEqual({ kind: 'error', message: 'bad', retryable: false })
    put.mockResolvedValue({ kind: 'error', status: 500, error: 'boom' })
    expect(await saveTrip(trip('a'), 1)).toEqual({ kind: 'error', message: 'boom', retryable: true })
  })

  it('never throws; a thrown client error is a retryable error', async () => {
    put.mockRejectedValue(new Error('kaboom'))
    expect(await saveTrip(trip('a'), 1)).toEqual({ kind: 'error', message: 'kaboom', retryable: true })
  })
})

describe('deleteTrip and saveTripSelection', () => {
  it('DELETEs /api/trips/{id}', async () => {
    del.mockResolvedValue(ok({ ok: true }))
    expect(await deleteTrip('t 1')).toEqual({ kind: 'saved' })
    expect(del).toHaveBeenCalledWith('/api/trips/t%201')
  })

  it('PUTs the selection', async () => {
    put.mockResolvedValue(ok({ ok: true }))
    expect(await saveTripSelection('t1')).toEqual({ kind: 'saved' })
    expect(put).toHaveBeenCalledWith('/api/trip-selection', { currentTripId: 't1' })
    await saveTripSelection(null)
    expect(put).toHaveBeenLastCalledWith('/api/trip-selection', { currentTripId: null })
  })

  it('map failures for both', async () => {
    del.mockResolvedValue(authFail)
    expect(await deleteTrip('a')).toEqual({ kind: 'session-expired' })
    del.mockResolvedValue(waking)
    expect(await deleteTrip('a')).toEqual({ kind: 'database-waking', retryAfterSeconds: 4 })
    del.mockResolvedValue({ kind: 'error', status: 500, error: 'boom' })
    expect(await deleteTrip('a')).toEqual({ kind: 'error', message: 'boom' })
    put.mockResolvedValue(authFail)
    expect(await saveTripSelection('a')).toEqual({ kind: 'session-expired' })
    put.mockResolvedValue({ kind: 'database-waking', status: 503 })
    expect(await saveTripSelection('a')).toEqual({ kind: 'database-waking' })
    put.mockResolvedValue({ kind: 'error', status: 500, error: 'boom' })
    expect(await saveTripSelection('a')).toEqual({ kind: 'error', message: 'boom' })
  })
})

describe('importTrips', () => {
  it('POSTs a single chunk for <= 200 trips', async () => {
    post.mockResolvedValue(ok({ imported: ['a'], skipped: ['b'] }))
    expect(await importTrips([trip('a'), trip('b')])).toEqual({ kind: 'imported', imported: ['a'], skipped: ['b'] })
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/api/trips/import', { trips: [trip('a'), trip('b')] })
  })

  it('chunks 450 trips into 200/200/50 and merges results', async () => {
    const trips = Array.from({ length: 450 }, (_, i) => trip(`t${i}`))
    post.mockImplementation(async (_p, body) => {
      const ids = (body as { trips: Trip[] }).trips.map((t) => t.id)
      return ok({ imported: ids, skipped: [] })
    })
    const r = await importTrips(trips)
    expect(post.mock.calls.map((c) => (c[1] as { trips: Trip[] }).trips.length)).toEqual([200, 200, 50])
    expect(r.kind === 'imported' && r.imported.length).toBe(450)
  })

  it('stops at the first failing chunk', async () => {
    const trips = Array.from({ length: 250 }, (_, i) => trip(`t${i}`))
    post.mockResolvedValueOnce(ok({ imported: [], skipped: [] })).mockResolvedValueOnce(waking)
    expect(await importTrips(trips)).toEqual({ kind: 'database-waking', retryAfterSeconds: 4 })
    post.mockReset()
    post.mockResolvedValue(authFail)
    expect(await importTrips(trips)).toEqual({ kind: 'session-expired' })
    expect(post).toHaveBeenCalledTimes(1)
    post.mockResolvedValue({ kind: 'error', status: 500, error: 'boom' })
    expect(await importTrips([trip('a')])).toEqual({ kind: 'error', message: 'boom' })
  })

  it('does nothing for an empty list', async () => {
    expect(await importTrips([])).toEqual({ kind: 'imported', imported: [], skipped: [] })
    expect(post).not.toHaveBeenCalled()
  })
})

describe('legacy helpers', () => {
  it('reads the trip-planner-trips key', () => {
    window.localStorage.setItem('trip-planner-trips', JSON.stringify({ trips: [trip('a')], currentTripId: null }))
    expect(readLegacyLocalTrips()).toEqual({ trips: [trip('a')], currentTripId: 'a' })
  })

  it('folds legacy stop fields from both legacy keys', () => {
    const stop = { id: 's', reservationNote: 'Gate code 1', source: { name: 'Other', fees: '$20' } }
    window.localStorage.setItem('trip-planner-trips', JSON.stringify({ trips: [{ ...trip('a'), stops: [stop] }], currentTripId: 'a' }))
    const a = readLegacyLocalTrips()?.trips[0].stops[0]
    expect(a).not.toHaveProperty('reservationNote')
    expect(a?.nightlyCost).toBe(20)
    expect(a?.note).toBe('Reservation: Gate code 1')
    window.localStorage.clear()
    window.localStorage.setItem('exported-trips', JSON.stringify({ version: '1', trips: [stop] }))
    const b = readLegacyLocalTrips()?.trips[0].stops[0]
    expect(b).not.toHaveProperty('reservationNote')
    expect(b?.nightlyCost).toBe(20)
  })

  it('migrates the exported-trips format', () => {
    window.localStorage.setItem('exported-trips', JSON.stringify({ version: '1', trips: [{ id: 's' }] }))
    const s = readLegacyLocalTrips()
    expect(s?.trips[0].name).toBe('Imported Trip')
    expect(s?.trips[0].stops).toEqual([{ id: 's' }])
    expect(s?.currentTripId).toBe(s?.trips[0].id)
  })

  it('returns null when empty and clear removes both keys', () => {
    expect(readLegacyLocalTrips()).toBeNull()
    window.localStorage.setItem('trip-planner-trips', '{}')
    window.localStorage.setItem('exported-trips', '{}')
    clearLegacyLocalTrips()
    expect(window.localStorage.getItem('trip-planner-trips')).toBeNull()
    expect(window.localStorage.getItem('exported-trips')).toBeNull()
  })
})

describe('pure helpers stay synchronous', () => {
  it('behave as before', () => {
    const t = createNewTrip('  ')
    expect(t.name).toBe('Untitled Trip')
    expect(getCurrentTrip({ trips: [trip('a')], currentTripId: 'a' })?.id).toBe('a')
    expect(getCurrentTrip({ trips: [], currentTripId: null })).toBeNull()
    expect(getTripsSortedByRecent([trip('o', '2020-01-01'), trip('n', '2024-01-01')]).map((x) => x.id)).toEqual(['n', 'o'])
  })
})
