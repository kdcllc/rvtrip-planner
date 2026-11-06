import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  validate: vi.fn(),
  query: vi.fn(),
  csrf: vi.fn(),
  registered: [] as Array<{ name: string; opts: Record<string, unknown> }>,
}))
vi.mock('mssql', () => ({ default: {} }))
vi.mock('@azure/functions', () => ({
  app: { http: (name: string, opts: Record<string, unknown>) => h.registered.push({ name, opts }) },
}))
vi.mock('../shared/session', () => ({ validateSession: h.validate }))
vi.mock('../shared/db', async () => {
  class DatabaseUnavailableError extends Error {}
  return {
    query: h.query,
    sql: { UniqueIdentifier: 'uid', NVarChar: () => 'nvarchar', MAX: 'max', Int: 'int' },
    DatabaseUnavailableError,
  }
})
vi.mock('../shared/http', async () => {
  const { DatabaseUnavailableError } = await import('../shared/db')
  return {
    csrfGuard: h.csrf,
    json: (b: unknown, status = 200) => ({ status, jsonBody: b }),
    error: (status: number, error: string, code?: string) => ({
      status,
      jsonBody: code ? { error, code } : { error },
    }),
    fromException: (e: unknown) =>
      e instanceof DatabaseUnavailableError ? { status: 503 } : { status: 500 },
  }
})

import { DatabaseUnavailableError } from '../shared/db'
import { deleteTrip, getTrips, importTrips, putTrip, putTripSelection } from './trips'

const trip = {
  id: 't1',
  name: 'Trip',
  stops: [{ id: 's1', label: 'A', address: 'x', startDate: '', endDate: '' }],
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
}
const trip2 = { ...trip, id: 't2', name: 'Two' }
const USER = { id: 'u1', email: 'a@b.c' }

const getReq = { method: 'GET', headers: { get: () => null } } as never
function mk(method: string, body?: unknown, params: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    method,
    params,
    headers: { get: (n: string) => headers[n] ?? null },
    text: async () => text,
  } as never
}
const put = (body: unknown, tripId = 't1', headers: Record<string, string> = {}) =>
  putTrip(mk('PUT', body, { tripId }, headers))
const unavailable = async () => { throw new DatabaseUnavailableError() }

beforeEach(() => {
  h.validate.mockReset()
  h.query.mockReset()
  h.csrf.mockReset()
  h.csrf.mockReturnValue(null)
  h.validate.mockResolvedValue(USER)
})

describe('registration', () => {
  it('registers per-trip routes without collision', () => {
    expect(h.registered.map((r) => [r.opts.route, r.opts.methods])).toEqual([
      ['trips', ['GET']],
      ['trips/import', ['POST']],
      ['trips/{tripId}', ['PUT']],
      ['trips/{tripId}', ['DELETE']],
      ['trip-selection', ['PUT']],
    ])
    expect(new Set(h.registered.map((r) => r.name)).size).toBe(h.registered.length)
  })
})

describe('GET /api/trips', () => {
  it('no session: 401, no query', async () => {
    h.validate.mockResolvedValue(null)
    const res = await getTrips(getReq)
    expect(res.status).toBe(401)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('returns parsed trips with versions in row order and the current trip', async () => {
    h.query
      .mockResolvedValueOnce({
        recordset: [
          { trip_id: 't2', data: JSON.stringify(trip2), version: 3 },
          { trip_id: 't1', data: JSON.stringify(trip), version: 1 },
          { trip_id: 'bad', data: '{nope', version: 1 },
        ],
      })
      .mockResolvedValueOnce({ recordset: [{ current_trip_id: 't1' }] })
    const res = await getTrips(getReq)
    expect(res.status).toBe(200)
    expect(res.jsonBody).toEqual({
      trips: [{ trip: trip2, version: 3 }, { trip, version: 1 }],
      currentTripId: 't1',
    })
    const [text, params] = h.query.mock.calls[0]
    expect(text).toMatch(/WHERE user_id = @userId/)
    expect(text).toMatch(/ORDER BY updated_at DESC/)
    expect(params.userId.value).toBe('u1')
  })

  it('current trip pointing at a missing trip is null', async () => {
    h.query
      .mockResolvedValueOnce({ recordset: [{ trip_id: 't1', data: JSON.stringify(trip), version: 1 }] })
      .mockResolvedValueOnce({ recordset: [{ current_trip_id: 'gone' }] })
    expect((await getTrips(getReq)).jsonBody).toMatchObject({ currentTripId: null })
  })

  it('empty: no trips, null current', async () => {
    h.query.mockResolvedValueOnce({ recordset: [] }).mockResolvedValueOnce({ recordset: [] })
    expect((await getTrips(getReq)).jsonBody).toEqual({ trips: [], currentTripId: null })
  })

  it('40613: 503', async () => {
    h.query.mockImplementation(unavailable)
    expect((await getTrips(getReq)).status).toBe(503)
  })
})

describe('PUT /api/trips/{tripId}', () => {
  it('CSRF failure short-circuits before session or write', async () => {
    h.csrf.mockReturnValue({ status: 403, jsonBody: { error: 'Forbidden' } })
    expect((await put({ trip, baseVersion: null })).status).toBe(403)
    expect(h.validate).not.toHaveBeenCalled()
    expect(h.query).not.toHaveBeenCalled()
  })

  it('no session: 401, no write', async () => {
    h.validate.mockResolvedValue(null)
    expect((await put({ trip, baseVersion: null })).status).toBe(401)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('create: inserts with session user id and sanitised JSON, returns version 1', async () => {
    h.query.mockResolvedValue({ recordset: [] })
    const res = await put({ trip: { ...trip, user_id: 'victim' }, baseVersion: null, userId: 'victim' })
    expect(res.status).toBe(200)
    expect(res.jsonBody).toEqual({ version: 1 })
    const [text, params] = h.query.mock.calls[0]
    expect(text).toMatch(/^INSERT INTO dbo\.user_trips/)
    expect(params.userId.value).toBe('u1')
    expect(params.tripId.value).toBe('t1')
    expect(JSON.parse(params.data.value)).toEqual(trip)
    expect(JSON.stringify(h.query.mock.calls)).not.toMatch(/victim/)
  })

  it('create on an existing row (duplicate key 2627): 409 with current', async () => {
    h.query
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { number: 2627 }))
      .mockResolvedValueOnce({ recordset: [{ data: JSON.stringify(trip), version: 4 }] })
    const res = await put({ trip, baseVersion: null })
    expect(res.status).toBe(409)
    expect(res.jsonBody).toEqual({
      error: 'Version conflict',
      code: 'VERSION_CONFLICT',
      current: { trip, version: 4 },
    })
  })

  it('create losing a race (2601 on originalError): 409, not 500', async () => {
    h.query
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { originalError: { number: 2601 } }))
      .mockResolvedValueOnce({ recordset: [{ data: JSON.stringify(trip), version: 1 }] })
    expect((await put({ trip, baseVersion: null })).status).toBe(409)
  })

  it('update: one conditional UPDATE scoped by session user and baseVersion', async () => {
    h.query.mockResolvedValue({ recordset: [{ version: 3 }] })
    const res = await put({ trip, baseVersion: 2 })
    expect(res.status).toBe(200)
    expect(res.jsonBody).toEqual({ version: 3 })
    expect(h.query).toHaveBeenCalledTimes(1)
    const [text, params] = h.query.mock.calls[0]
    expect(text).toMatch(/version = version \+ 1/)
    expect(text).toMatch(/OUTPUT inserted\.version/)
    expect(text).toMatch(/WHERE user_id = @userId AND trip_id = @tripId AND version = @baseVersion/)
    expect(params.userId.value).toBe('u1')
    expect(params.baseVersion.value).toBe(2)
  })

  it('update with stale version: 409 carrying the current row', async () => {
    h.query
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ data: JSON.stringify(trip), version: 5 }] })
    const res = await put({ trip, baseVersion: 2 })
    expect(res.status).toBe(409)
    expect(res.jsonBody).toMatchObject({ code: 'VERSION_CONFLICT', current: { trip, version: 5 } })
    const [text, params] = h.query.mock.calls[1]
    expect(text).toMatch(/WHERE user_id = @userId AND trip_id = @tripId/)
    expect(params.userId.value).toBe('u1')
  })

  it('update of a deleted trip: 409 with current null', async () => {
    h.query.mockResolvedValue({ recordset: [] })
    const res = await put({ trip, baseVersion: 1 })
    expect(res.status).toBe(409)
    expect(res.jsonBody).toMatchObject({ code: 'VERSION_CONFLICT', current: null })
  })

  it.each([
    ['not JSON', '{nope'],
    ['array', []],
    ['missing trip', { baseVersion: null }],
    ['bad trip', { trip: { id: 't1' }, baseVersion: null }],
    ['id mismatch', { trip: { ...trip, id: 'other' }, baseVersion: null }],
    ['missing baseVersion', { trip }],
    ['string baseVersion', { trip, baseVersion: '1' }],
    ['zero baseVersion', { trip, baseVersion: 0 }],
    ['fractional baseVersion', { trip, baseVersion: 1.5 }],
  ])('malformed (%s): 400, no write', async (_n, body) => {
    const res = await put(body)
    expect(res.status).toBe(400)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('tripId length 1-128: empty and 129 chars rejected, 128 accepted', async () => {
    h.query.mockResolvedValue({ recordset: [] })
    const long = 'x'.repeat(129)
    expect((await put({ trip: { ...trip, id: '' }, baseVersion: null }, '')).status).toBe(400)
    expect((await put({ trip: { ...trip, id: long }, baseVersion: null }, long)).status).toBe(400)
    expect(h.query).not.toHaveBeenCalled()
    const ok = 'x'.repeat(128)
    expect((await put({ trip: { ...trip, id: ok }, baseVersion: null }, ok)).status).toBe(200)
  })

  it('declared content-length over 30 MB: 413, no write', async () => {
    const res = await put({ trip, baseVersion: null }, 't1', { 'content-length': String(31 * 1024 * 1024) })
    expect(res.status).toBe(413)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('actual body over 30 MB: 413, no write', async () => {
    expect((await put('x'.repeat(30 * 1024 * 1024 + 1))).status).toBe(413)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('40613: 503; other DB error: 500', async () => {
    h.query.mockImplementation(unavailable)
    expect((await put({ trip, baseVersion: null })).status).toBe(503)
    h.query.mockReset()
    h.query.mockRejectedValue(new Error('boom'))
    expect((await put({ trip, baseVersion: null })).status).toBe(500)
  })
})

describe('DELETE /api/trips/{tripId}', () => {
  const del = (tripId = 't1') => deleteTrip(mk('DELETE', undefined, { tripId }))

  it('CSRF and session guards', async () => {
    h.csrf.mockReturnValue({ status: 403, jsonBody: { error: 'Forbidden' } })
    expect((await del()).status).toBe(403)
    h.csrf.mockReturnValue(null)
    h.validate.mockResolvedValue(null)
    expect((await del()).status).toBe(401)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('deletes scoped by session user and clears the current trip pointer', async () => {
    h.query.mockResolvedValue({ recordset: [] })
    const res = await del()
    expect(res.status).toBe(200)
    expect(res.jsonBody).toEqual({ ok: true })
    const [text, params] = h.query.mock.calls[0]
    expect(text).toMatch(/DELETE FROM dbo\.user_trips WHERE user_id = @userId AND trip_id = @tripId/)
    expect(text).toMatch(/UPDATE dbo\.users SET current_trip_id = NULL WHERE id = @userId AND current_trip_id = @tripId/)
    expect(params.userId.value).toBe('u1')
    expect(params.tripId.value).toBe('t1')
  })

  it('absent trip is still 200 (idempotent)', async () => {
    h.query.mockResolvedValue({ recordset: [], rowsAffected: [0, 0] })
    expect((await del('nope')).status).toBe(200)
  })

  it('invalid tripId: 400; 40613: 503', async () => {
    expect((await del('')).status).toBe(400)
    expect((await del('x'.repeat(129))).status).toBe(400)
    expect(h.query).not.toHaveBeenCalled()
    h.query.mockImplementation(unavailable)
    expect((await del()).status).toBe(503)
  })
})

describe('POST /api/trips/import', () => {
  const imp = (body: unknown, headers: Record<string, string> = {}) => importTrips(mk('POST', body, {}, headers))

  it('CSRF and session guards', async () => {
    h.csrf.mockReturnValue({ status: 403, jsonBody: { error: 'Forbidden' } })
    expect((await imp({ trips: [trip] })).status).toBe(403)
    h.csrf.mockReturnValue(null)
    h.validate.mockResolvedValue(null)
    expect((await imp({ trips: [trip] })).status).toBe(401)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('inserts absent ids, skips present ones and in-payload duplicates (first wins)', async () => {
    h.query
      .mockResolvedValueOnce({ rowsAffected: [1] }) // t1 inserted
      .mockResolvedValueOnce({ rowsAffected: [0] }) // t2 already exists
    const res = await imp({ trips: [trip, trip2, { ...trip, name: 'dup of t1' }] })
    expect(res.status).toBe(200)
    expect(res.jsonBody).toEqual({ imported: ['t1'], skipped: ['t2', 't1'] })
    expect(h.query).toHaveBeenCalledTimes(2)
    const [text, params] = h.query.mock.calls[0]
    expect(text).toMatch(/WHERE NOT EXISTS/)
    expect(params.userId.value).toBe('u1')
    expect(JSON.parse(params.data.value).name).toBe('Trip')
  })

  it('duplicate-key race on one trip is skipped, not a 500', async () => {
    h.query.mockRejectedValueOnce(Object.assign(new Error('dup'), { number: 2627 }))
    expect((await imp({ trips: [trip] })).jsonBody).toEqual({ imported: [], skipped: ['t1'] })
  })

  it('empty list: 200 with empty lists', async () => {
    expect((await imp({ trips: [] })).jsonBody).toEqual({ imported: [], skipped: [] })
    expect(h.query).not.toHaveBeenCalled()
  })

  it('exactly 200 accepted; 201 rejected', async () => {
    h.query.mockResolvedValue({ rowsAffected: [1] })
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...trip, id: `t${i}` }))
    expect((await imp({ trips: many(200) })).status).toBe(200)
    h.query.mockClear()
    expect((await imp({ trips: many(201) })).status).toBe(400)
    expect(h.query).not.toHaveBeenCalled()
  })

  it.each([
    ['not JSON', '{nope'],
    ['no trips', {}],
    ['trips not array', { trips: 'x' }],
    ['one bad trip', { trips: [trip, { id: 'z' }] }],
    ['id too long', { trips: [{ ...trip, id: 'x'.repeat(129) }] }],
    ['empty id', { trips: [{ ...trip, id: '' }] }],
  ])('malformed (%s): 400, no write', async (_n, body) => {
    expect((await imp(body)).status).toBe(400)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('413 on declared size; 503 on 40613', async () => {
    expect((await imp({ trips: [] }, { 'content-length': String(31 * 1024 * 1024) })).status).toBe(413)
    h.query.mockImplementation(unavailable)
    expect((await imp({ trips: [trip] })).status).toBe(503)
  })
})

describe('PUT /api/trip-selection', () => {
  const sel = (body: unknown, headers: Record<string, string> = {}) => putTripSelection(mk('PUT', body, {}, headers))

  it('CSRF and session guards', async () => {
    h.csrf.mockReturnValue({ status: 403, jsonBody: { error: 'Forbidden' } })
    expect((await sel({ currentTripId: 't1' })).status).toBe(403)
    h.csrf.mockReturnValue(null)
    h.validate.mockResolvedValue(null)
    expect((await sel({ currentTripId: 't1' })).status).toBe(401)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('sets the id for the session user; null clears', async () => {
    h.query.mockResolvedValue({ recordset: [] })
    expect((await sel({ currentTripId: 't1', userId: 'victim' })).jsonBody).toEqual({ ok: true })
    const [text, params] = h.query.mock.calls[0]
    expect(text).toMatch(/UPDATE dbo\.users SET current_trip_id = @currentTripId WHERE id = @userId/)
    expect(params.userId.value).toBe('u1')
    expect(params.currentTripId.value).toBe('t1')
    expect((await sel({ currentTripId: null })).status).toBe(200)
    expect(h.query.mock.calls[1][1].currentTripId.value).toBeNull()
  })

  it.each([
    ['not JSON', '{nope'],
    ['array', []],
    ['missing', {}],
    ['number', { currentTripId: 5 }],
    ['too long', { currentTripId: 'x'.repeat(129) }],
  ])('malformed (%s): 400, no write', async (_n, body) => {
    expect((await sel(body)).status).toBe(400)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('413 and 503', async () => {
    expect((await sel({ currentTripId: null }, { 'content-length': String(31 * 1024 * 1024) })).status).toBe(413)
    h.query.mockImplementation(unavailable)
    expect((await sel({ currentTripId: null })).status).toBe(503)
  })
})
