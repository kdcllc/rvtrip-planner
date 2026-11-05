import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../auth/apiClient', () => ({ apiGet: vi.fn(), apiPut: vi.fn() }))

import { apiGet, apiPut } from '../auth/apiClient'
import {
  clearLegacyLocalTrips,
  createNewTrip,
  getCurrentTrip,
  getTripsSortedByRecent,
  loadTripsFromStorage,
  readLegacyLocalTrips,
  saveTripsToStorage,
  updateTripTimestamp,
} from './tripStorage'
import type { Trip, TripsState } from '../../domain/trip/types'

const get = vi.mocked(apiGet)
const put = vi.mocked(apiPut)

const trip = (id: string, updatedAt = '2024-01-01T00:00:00.000Z'): Trip => ({
  id,
  name: id,
  stops: [],
  createdAt: updatedAt,
  updatedAt,
})

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

describe('loadTripsFromStorage', () => {
  it('returns a promise and loads from GET /api/trips', async () => {
    get.mockResolvedValue({ kind: 'success', status: 200, data: { trips: [trip('a')], currentTripId: 'a' } })
    const p = loadTripsFromStorage()
    expect(p).toBeInstanceOf(Promise)
    const r = await p
    expect(get).toHaveBeenCalledWith('/api/trips')
    expect(r).toEqual({ kind: 'loaded', state: { trips: [trip('a')], currentTripId: 'a' }, isNew: false })
  })

  it('creates a default trip only for a genuinely empty server state', async () => {
    get.mockResolvedValue({ kind: 'success', status: 200, data: { trips: [], currentTripId: null } })
    const r = await loadTripsFromStorage()
    expect(r.kind).toBe('loaded')
    if (r.kind === 'loaded') {
      expect(r.isNew).toBe(true)
      expect(r.state.trips).toHaveLength(1)
    }
  })

  it('surfaces 503 as database-waking', async () => {
    get.mockResolvedValue({ kind: 'database-waking', status: 503, retryAfterSeconds: 2 })
    expect(await loadTripsFromStorage()).toEqual({ kind: 'database-waking', retryAfterSeconds: 2 })
  })

  it('surfaces 401 as session-expired', async () => {
    get.mockResolvedValue({ kind: 'auth-failure', status: 401, error: 'no' })
    expect(await loadTripsFromStorage()).toEqual({ kind: 'session-expired' })
  })

  it('does not fabricate a default trip on failure or serve local data', async () => {
    window.localStorage.setItem('trip-planner-trips', JSON.stringify({ trips: [trip('local')], currentTripId: 'local' }))
    get.mockResolvedValue({ kind: 'error', status: 500, error: 'boom' })
    const r = await loadTripsFromStorage()
    expect(r).toEqual({ kind: 'error', message: 'boom' })
    expect('state' in r).toBe(false)
  })
})

describe('saveTripsToStorage', () => {
  const state = (id: string): TripsState => ({ trips: [trip(id)], currentTripId: id })

  it('PUTs and returns saved', async () => {
    put.mockResolvedValue({ kind: 'success', status: 200, data: { ok: true } })
    const p = saveTripsToStorage(state('a'))
    expect(p).toBeInstanceOf(Promise)
    expect(await p).toEqual({ kind: 'saved' })
    expect(put).toHaveBeenCalledWith('/api/trips', state('a'))
  })

  it('returns typed failures without throwing', async () => {
    put.mockResolvedValueOnce({ kind: 'database-waking', status: 503 })
    expect(await saveTripsToStorage(state('a'))).toEqual({ kind: 'database-waking' })
    put.mockResolvedValueOnce({ kind: 'auth-failure', status: 401, error: 'x' })
    expect(await saveTripsToStorage(state('a'))).toEqual({ kind: 'session-expired' })
    put.mockRejectedValueOnce(new Error('net'))
    expect(await saveTripsToStorage(state('a'))).toEqual({ kind: 'error', message: 'net' })
  })

  it('coalesces rapid saves to last-write-wins', async () => {
    let release!: () => void
    put.mockImplementationOnce(
      () => new Promise((res) => { release = () => res({ kind: 'success', status: 200, data: { ok: true } }) })
    )
    put.mockResolvedValue({ kind: 'success', status: 200, data: { ok: true } })
    const p1 = saveTripsToStorage(state('1'))
    const p2 = saveTripsToStorage(state('2'))
    const p3 = saveTripsToStorage(state('3'))
    release()
    await Promise.all([p1, p2, p3])
    expect(put).toHaveBeenCalledTimes(2)
    expect(put).toHaveBeenLastCalledWith('/api/trips', state('3'))
  })
})

describe('legacy helpers', () => {
  it('reads the trip-planner-trips key', () => {
    window.localStorage.setItem('trip-planner-trips', JSON.stringify({ trips: [trip('a')], currentTripId: null }))
    expect(readLegacyLocalTrips()).toEqual({ trips: [trip('a')], currentTripId: 'a' })
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
    const old = trip('a')
    const u = updateTripTimestamp(old)
    expect(u.updatedAt).not.toBe(old.updatedAt)
    expect(u.id).toBe('a')
  })
})
