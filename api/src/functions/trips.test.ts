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
    sql: { UniqueIdentifier: 'uid', NVarChar: () => 'nvarchar', MAX: 'max' },
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
import { getTrips, putTrips } from './trips'

const state = {
  trips: [
    {
      id: 't1',
      name: 'Trip',
      stops: [{ id: 's1', label: 'A', address: 'x', startDate: '', endDate: '' }],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ],
  currentTripId: 't1',
}

const getReq = { method: 'GET', headers: { get: () => null } } as never
function putReq(body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    method: 'PUT',
    headers: { get: (n: string) => headers[n] ?? null },
    text: async () => text,
  } as never
}

beforeEach(() => {
  h.validate.mockReset()
  h.query.mockReset()
  h.csrf.mockReset()
  h.csrf.mockReturnValue(null)
})

describe('registration', () => {
  it('registers GET and PUT triggers on route trips', () => {
    expect(h.registered.map((r) => [r.opts.route, r.opts.methods])).toEqual([
      ['trips', ['GET']],
      ['trips', ['PUT']],
    ])
  })
})

describe('GET /api/trips', () => {
  it('no/expired session: 401, no query, no data', async () => {
    h.validate.mockResolvedValue(null)
    const res = await getTrips(getReq)
    expect(res.status).toBe(401)
    expect(h.query).not.toHaveBeenCalled()
    expect(JSON.stringify(res.jsonBody)).not.toMatch(/trips/)
  })

  it('filters by the session user id with a parameterised query', async () => {
    h.validate.mockResolvedValue({ id: 'u1', email: 'a@b.c' })
    h.query.mockResolvedValue({ recordset: [{ data: JSON.stringify(state) }] })
    const res = await getTrips(getReq)
    expect(res.status).toBe(200)
    expect(res.jsonBody).toEqual(state)
    const [text, params] = h.query.mock.calls[0]
    expect(text).toMatch(/WHERE user_id = @userId/)
    expect(params.userId.value).toBe('u1')
  })

  it('user with no rows: empty TripsState', async () => {
    h.validate.mockResolvedValue({ id: 'u1', email: 'a@b.c' })
    h.query.mockResolvedValue({ recordset: [] })
    const res = await getTrips(getReq)
    expect(res.status).toBe(200)
    expect(res.jsonBody).toEqual({ trips: [], currentTripId: null })
  })

  it('40613: 503', async () => {
    h.validate.mockResolvedValue({ id: 'u1', email: 'a@b.c' })
    h.query.mockImplementation(async () => { throw new DatabaseUnavailableError() })
    expect((await getTrips(getReq)).status).toBe(503)
  })
})

describe('PUT /api/trips', () => {
  it('CSRF failure short-circuits before session or write', async () => {
    h.csrf.mockReturnValue({ status: 403, jsonBody: { error: 'Forbidden' } })
    const res = await putTrips(putReq(state))
    expect(res.status).toBe(403)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('no session: 401, no write', async () => {
    h.validate.mockResolvedValue(null)
    expect((await putTrips(putReq(state))).status).toBe(401)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('valid payload: upserts with session user id and JSON text', async () => {
    h.validate.mockResolvedValue({ id: 'u1', email: 'a@b.c' })
    h.query.mockResolvedValue({ recordset: [] })
    const res = await putTrips(putReq(state))
    expect(res.status).toBe(200)
    expect(res.jsonBody).toEqual({ ok: true })
    const [text, params] = h.query.mock.calls[0]
    expect(text).toMatch(/UPDATE dbo\.trips/)
    expect(text).toMatch(/INSERT INTO dbo\.trips/)
    expect(params.userId.value).toBe('u1')
    expect(JSON.parse(params.data.value)).toEqual(state)
  })

  it('cross-user isolation: body user_id is ignored and never written', async () => {
    h.validate.mockResolvedValue({ id: 'session-user', email: 'a@b.c' })
    h.query.mockResolvedValue({ recordset: [] })
    const res = await putTrips(putReq({ ...state, user_id: 'victim', userId: 'victim' }))
    expect(res.status).toBe(200)
    const [, params] = h.query.mock.calls[0]
    expect(params.userId.value).toBe('session-user')
    expect(JSON.stringify(h.query.mock.calls)).not.toMatch(/victim/)
  })

  it.each([
    ['not JSON', '{nope'],
    ['array', []],
    ['missing trips', { currentTripId: null }],
    ['bad currentTripId', { trips: [], currentTripId: 5 }],
    ['bad trip', { trips: [{ id: 1 }], currentTripId: null }],
  ])('malformed (%s): 400, no write', async (_n, body) => {
    h.validate.mockResolvedValue({ id: 'u1', email: 'a@b.c' })
    const res = await putTrips(putReq(body as never))
    expect(res.status).toBe(400)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('declared content-length over 30 MB: 413, no write', async () => {
    h.validate.mockResolvedValue({ id: 'u1', email: 'a@b.c' })
    const res = await putTrips(putReq(state, { 'content-length': String(31 * 1024 * 1024) }))
    expect(res.status).toBe(413)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('actual body over 30 MB: 413, no write', async () => {
    h.validate.mockResolvedValue({ id: 'u1', email: 'a@b.c' })
    const res = await putTrips(putReq('x'.repeat(30 * 1024 * 1024 + 1)))
    expect(res.status).toBe(413)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('40613: 503', async () => {
    h.validate.mockResolvedValue({ id: 'u1', email: 'a@b.c' })
    h.query.mockImplementation(async () => { throw new DatabaseUnavailableError() })
    expect((await putTrips(putReq(state))).status).toBe(503)
  })
})
