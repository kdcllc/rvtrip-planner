import { describe, expect, it } from 'vitest'
import type { VersionedTrip } from '../../types/api'
import { mergeServerTrips, type SyncMergeInput } from './syncMerge'
import type { Trip } from './types'

const trip = (id: string, name = id): Trip => ({
  id,
  name,
  stops: [],
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
})
const vt = (t: Trip, version: number): VersionedTrip => ({ trip: t, version })

const base = (over: Partial<SyncMergeInput> = {}): SyncMergeInput => ({
  local: { trips: [], currentTripId: null },
  savedTrips: new Map(),
  versions: {},
  pendingDeletes: new Set(),
  server: { trips: [], currentTripId: null },
  ...over,
})

describe('mergeServerTrips', () => {
  it('replaces a clean local trip with the server copy and records its version', () => {
    const local = trip('a', 'Old')
    const serverA = trip('a', 'New')
    const r = mergeServerTrips(
      base({
        local: { trips: [local], currentTripId: 'a' },
        savedTrips: new Map([['a', local]]),
        versions: { a: 1 },
        server: { trips: [vt(serverA, 2)], currentTripId: 'a' },
      }),
    )
    expect(r.state.trips).toEqual([serverA])
    expect(r.state.trips[0]).toBe(serverA)
    expect(r.savedTrips.get('a')).toBe(serverA)
    expect(r.versions).toEqual({ a: 2 })
    expect(r.overwritten).toEqual([])
  })

  it('adds server-only trips', () => {
    const s = trip('s', 'Srv')
    const r = mergeServerTrips(base({ server: { trips: [vt(s, 4)], currentTripId: 's' } }))
    expect(r.state.trips).toEqual([s])
    expect(r.versions).toEqual({ s: 4 })
  })

  it('excludes a pending-delete trip from state and saved map but keeps its version', () => {
    const s = trip('d', 'Doomed')
    const r = mergeServerTrips(
      base({
        pendingDeletes: new Set(['d']),
        server: { trips: [vt(s, 7)], currentTripId: null },
      }),
    )
    expect(r.state.trips).toEqual([])
    expect(r.savedTrips.has('d')).toBe(false)
    expect(r.versions).toEqual({ d: 7 })
  })

  it('reports a dirty local trip whose content differs from the server as overwritten', () => {
    const saved = trip('a', 'Saved')
    const dirty = trip('a', 'Edited')
    const serverA = trip('a', 'Server')
    const r = mergeServerTrips(
      base({
        local: { trips: [dirty], currentTripId: 'a' },
        savedTrips: new Map([['a', saved]]),
        versions: { a: 1 },
        server: { trips: [vt(serverA, 2)], currentTripId: 'a' },
      }),
    )
    expect(r.overwritten).toEqual(['Edited'])
    expect(r.state.trips).toEqual([serverA])
  })

  it('does not report a dirty trip whose content equals the server copy', () => {
    const saved = trip('a', 'Saved')
    const dirty = trip('a', 'Same')
    const r = mergeServerTrips(
      base({
        local: { trips: [dirty], currentTripId: 'a' },
        savedTrips: new Map([['a', saved]]),
        versions: { a: 1 },
        server: { trips: [vt(trip('a', 'Same'), 2)], currentTripId: 'a' },
      }),
    )
    expect(r.overwritten).toEqual([])
  })

  it('does not report a clean local trip', () => {
    const local = trip('a', 'A')
    const r = mergeServerTrips(
      base({
        local: { trips: [local], currentTripId: 'a' },
        savedTrips: new Map([['a', local]]),
        versions: { a: 1 },
        server: { trips: [vt(trip('a', 'Other'), 2)], currentTripId: 'a' },
      }),
    )
    expect(r.overwritten).toEqual([])
  })

  it('removes a trip deleted elsewhere (clean, known version) without reporting it', () => {
    const local = trip('gone', 'Gone')
    const r = mergeServerTrips(
      base({
        local: { trips: [local], currentTripId: 'gone' },
        savedTrips: new Map([['gone', local]]),
        versions: { gone: 3 },
      }),
    )
    expect(r.state.trips).toEqual([])
    expect(r.overwritten).toEqual([])
    expect(r.versions).toEqual({})
  })

  it('removes a dirty trip deleted elsewhere and reports it as overwritten', () => {
    const saved = trip('gone', 'Gone')
    const dirty = trip('gone', 'Gone edited')
    const r = mergeServerTrips(
      base({
        local: { trips: [dirty], currentTripId: 'gone' },
        savedTrips: new Map([['gone', saved]]),
        versions: { gone: 3 },
      }),
    )
    expect(r.state.trips).toEqual([])
    expect(r.overwritten).toEqual(['Gone edited'])
  })

  it('keeps never-saved local trips and appends them after server trips', () => {
    const fresh = trip('new', 'Fresh')
    const s = trip('s', 'Srv')
    const r = mergeServerTrips(
      base({
        local: { trips: [fresh], currentTripId: 'new' },
        server: { trips: [vt(s, 1)], currentTripId: 's' },
      }),
    )
    expect(r.state.trips.map((t) => t.id)).toEqual(['s', 'new'])
    expect(r.state.trips[1]).toBe(fresh)
    expect(r.savedTrips.has('new')).toBe(false)
    expect(r.versions).toEqual({ s: 1 })
    expect(r.overwritten).toEqual([])
  })

  it('orders server trips in server order, then unsaved local trips in local order', () => {
    const r = mergeServerTrips(
      base({
        local: { trips: [trip('n2'), trip('n1')], currentTripId: null },
        server: { trips: [vt(trip('b'), 1), vt(trip('a'), 1)], currentTripId: null },
      }),
    )
    expect(r.state.trips.map((t) => t.id)).toEqual(['b', 'a', 'n2', 'n1'])
  })

  it('prefers the local current trip id when it survives the merge', () => {
    const r = mergeServerTrips(
      base({
        local: { trips: [trip('n')], currentTripId: 'n' },
        server: { trips: [vt(trip('s'), 1)], currentTripId: 's' },
      }),
    )
    expect(r.state.currentTripId).toBe('n')
  })

  it('falls back to the server current trip id when the local one is gone', () => {
    const gone = trip('gone')
    const r = mergeServerTrips(
      base({
        local: { trips: [gone], currentTripId: 'gone' },
        savedTrips: new Map([['gone', gone]]),
        versions: { gone: 1 },
        server: { trips: [vt(trip('x'), 1), vt(trip('s'), 1)], currentTripId: 's' },
      }),
    )
    expect(r.state.currentTripId).toBe('s')
  })

  it('falls back to the first trip when neither selection survives', () => {
    const r = mergeServerTrips(
      base({
        local: { trips: [], currentTripId: 'missing' },
        server: { trips: [vt(trip('x'), 1), vt(trip('y'), 1)], currentTripId: 'also-missing' },
      }),
    )
    expect(r.state.currentTripId).toBe('x')
  })

  it('yields a null current trip when nothing remains', () => {
    const r = mergeServerTrips(base({ local: { trips: [], currentTripId: 'zzz' } }))
    expect(r.state).toEqual({ trips: [], currentTripId: null })
  })

  it('does not duplicate trips present both locally and on the server', () => {
    const local = trip('a', 'A')
    const r = mergeServerTrips(
      base({
        local: { trips: [local], currentTripId: 'a' },
        savedTrips: new Map([['a', local]]),
        versions: { a: 1 },
        server: { trips: [vt(trip('a', 'A2'), 2)], currentTripId: 'a' },
      }),
    )
    expect(r.state.trips.filter((t) => t.id === 'a')).toHaveLength(1)
  })

  it('de-duplicates overwritten names', () => {
    const a = trip('a', 'Same')
    const b = trip('b', 'Same')
    const r = mergeServerTrips(
      base({
        local: { trips: [trip('a', 'Same'), trip('b', 'Same')], currentTripId: 'a' },
        savedTrips: new Map([
          ['a', a],
          ['b', b],
        ]),
        versions: { a: 1, b: 1 },
        server: { trips: [vt(trip('a', 'Srv A'), 2), vt(trip('b', 'Srv B'), 2)], currentTripId: 'a' },
      }),
    )
    expect(r.overwritten).toEqual(['Same'])
  })

  it('reports a dirty local trip that is pending-delete on the server when its JSON differs, and drops it', () => {
    const saved = trip('d', 'Saved')
    const dirty = trip('d', 'Edited')
    const r = mergeServerTrips(
      base({
        local: { trips: [dirty], currentTripId: 'd' },
        savedTrips: new Map([['d', saved]]),
        versions: { d: 1 },
        pendingDeletes: new Set(['d']),
        server: { trips: [vt(trip('d', 'Server'), 2)], currentTripId: 'd' },
      }),
    )
    expect(r.overwritten).toEqual(['Edited'])
    expect(r.state.trips).toEqual([])
    expect(r.versions).toEqual({ d: 2 })
  })

  it('does not mutate its inputs', () => {
    const local = trip('a', 'A')
    const input = base({
      local: { trips: [local, trip('n')], currentTripId: 'a' },
      savedTrips: new Map([['a', local]]),
      versions: { a: 1 },
      pendingDeletes: new Set(['p']),
      server: { trips: [vt(trip('a', 'A2'), 2), vt(trip('p'), 1)], currentTripId: 'a' },
    })
    const snapshot = JSON.stringify({
      local: input.local,
      saved: [...input.savedTrips],
      versions: input.versions,
      pd: [...input.pendingDeletes],
      server: input.server,
    })
    const r = mergeServerTrips(input)
    expect(
      JSON.stringify({
        local: input.local,
        saved: [...input.savedTrips],
        versions: input.versions,
        pd: [...input.pendingDeletes],
        server: input.server,
      }),
    ).toBe(snapshot)
    expect(r.savedTrips).not.toBe(input.savedTrips)
    expect(r.versions).not.toBe(input.versions)
  })
})
