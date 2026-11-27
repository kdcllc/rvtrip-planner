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
import { getVehicles, putVehicles } from './vehicles'

const USER = { id: 'ABC-DEF', email: 'a@b.c' }
const v1 = { id: 'v1', name: 'Rig', fuelType: 'diesel', mpg: 9.5, tankGallons: 80 }
const v2 = { id: 'v2', name: 'Van', fuelType: 'gasoline', mpg: 18, tankGallons: null }
const garage = { vehicles: [v1, v2], defaultVehicleId: 'v2' }

const getReq = { method: 'GET', headers: { get: () => null } } as never
function mk(body?: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { method: 'PUT', headers: { get: (n: string) => headers[n] ?? null }, text: async () => text } as never
}
const put = (body: unknown, headers: Record<string, string> = {}) => putVehicles(mk(body, headers))
const withG = (patch: Record<string, unknown>) => ({ garage: { ...garage, ...patch } })
const withV = (patch: Record<string, unknown>) => withG({ vehicles: [{ ...v1, ...patch }, v2] })
const unavailable = async () => {
  throw new DatabaseUnavailableError()
}

beforeEach(() => {
  h.validate.mockReset()
  h.query.mockReset()
  h.csrf.mockReset()
  h.csrf.mockReturnValue(null)
  h.validate.mockResolvedValue(USER)
  h.query.mockResolvedValue({ recordset: [] })
})

describe('registration', () => {
  it('registers GET and PUT on vehicles', () => {
    expect(h.registered.map((r) => [r.name, r.opts.route, r.opts.methods, r.opts.authLevel])).toEqual([
      ['getVehicles', 'vehicles', ['GET'], 'anonymous'],
      ['putVehicles', 'vehicles', ['PUT'], 'anonymous'],
    ])
  })
})

describe('GET /api/vehicles', () => {
  it('no session: 401, no query', async () => {
    h.validate.mockResolvedValue(null)
    expect((await getVehicles(getReq)).status).toBe(401)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('returns the stored garage for the session user', async () => {
    h.query.mockResolvedValue({ recordset: [{ data: JSON.stringify(garage) }] })
    const res = await getVehicles(getReq)
    expect(res.status).toBe(200)
    expect(res.jsonBody).toEqual({ garage })
    const [text, params] = h.query.mock.calls[0]
    expect(text).toMatch(/WHERE user_id = @userId/)
    expect(params.userId.value).toBe('ABC-DEF')
  })

  it('no row: garage null', async () => {
    const res = await getVehicles(getReq)
    expect(res.status).toBe(200)
    expect(res.jsonBody).toEqual({ garage: null })
  })

  it('legacy single profile becomes a one-vehicle garage keyed by the lower-case user id', async () => {
    const legacy = { name: 'Old', fuelType: 'diesel', mpg: 10, tankGallons: 60 }
    h.query.mockResolvedValue({ recordset: [{ data: JSON.stringify(legacy) }] })
    const res = await getVehicles(getReq)
    expect(res.jsonBody).toEqual({
      garage: { vehicles: [{ ...legacy, id: 'abc-def' }], defaultVehicleId: 'abc-def' },
    })
  })

  it.each([['not json', '{nope'], ['invalid profile', JSON.stringify({ name: 'x' })], ['bad garage', JSON.stringify({ vehicles: [] })], ['array', '[]']])(
    'invalid row (%s): garage null',
    async (_l, data) => {
      h.query.mockResolvedValue({ recordset: [{ data }] })
      expect((await getVehicles(getReq)).jsonBody).toEqual({ garage: null })
    },
  )

  it('40613: 503', async () => {
    h.query.mockImplementation(unavailable)
    expect((await getVehicles(getReq)).status).toBe(503)
  })
})

describe('PUT /api/vehicles', () => {
  it('no session: 401, no query', async () => {
    h.validate.mockResolvedValue(null)
    expect((await put({ garage })).status).toBe(401)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('CSRF failure: 403, no query', async () => {
    h.csrf.mockReturnValue({ status: 403, jsonBody: { error: 'CSRF' } })
    expect((await put({ garage })).status).toBe(403)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('stores trimmed names, drops extra fields, upserts for the session user', async () => {
    const res = await put({
      garage: { vehicles: [{ ...v1, name: '  Rig  ', extra: 'x' }, v2], defaultVehicleId: 'v1', more: 1 },
      other: 1,
    })
    const stored = { vehicles: [v1, v2], defaultVehicleId: 'v1' }
    expect(res.status).toBe(200)
    expect(res.jsonBody).toEqual({ garage: stored })
    expect(h.query).toHaveBeenCalledTimes(1)
    const [text, params] = h.query.mock.calls[0]
    expect(text).toMatch(/MERGE dbo\.vehicle_profiles/)
    expect(text).toMatch(/updated_at = SYSUTCDATETIME\(\)/)
    expect(params.userId.value).toBe('ABC-DEF')
    expect(JSON.parse(params.data.value)).toEqual(stored)
  })

  it('accepts an empty name, null tankGallons and boundary values', async () => {
    expect((await put(withV({ name: '', tankGallons: null }))).status).toBe(200)
    expect((await put(withV({ mpg: 5, tankGallons: 1 }))).status).toBe(200)
    expect((await put(withV({ mpg: 100, tankGallons: 300, name: 'a'.repeat(80) }))).status).toBe(200)
  })

  const tenVehicles = (n: number) => Array.from({ length: n }, (_, i) => ({ ...v1, id: `v${i}` }))
  it.each([
    ['body not an object', 'null', 'garage'],
    ['no garage', {}, 'garage'],
    ['garage not an object', { garage: 'x' }, 'garage'],
    ['vehicles not an array', withG({ vehicles: 'x' }), 'vehicles'],
    ['vehicles empty', withG({ vehicles: [] }), 'vehicles'],
    ['too many vehicles', { garage: { vehicles: tenVehicles(11), defaultVehicleId: 'v0' } }, 'vehicles'],
    ['vehicle not an object', withG({ vehicles: ['x'] }), 'vehicle'],
    ['id not a string', withV({ id: 5 }), 'id'],
    ['id bad characters', withV({ id: 'bad id!' }), 'id'],
    ['id too long', withV({ id: 'a'.repeat(65) }), 'id'],
    ['duplicate ids', withV({ id: 'v2' }), 'unique'],
    ['unknown defaultVehicleId', withG({ defaultVehicleId: 'zzz' }), 'defaultVehicleId'],
    ['name not a string', withV({ name: 5 }), 'name'],
    ['name too long', withV({ name: 'a'.repeat(81) }), 'name'],
    ['bad fuelType', withV({ fuelType: 'propane' }), 'fuelType'],
    ['mpg string', withV({ mpg: '9' }), 'mpg'],
    ['mpg too low', withV({ mpg: 4.9 }), 'mpg'],
    ['mpg too high', withV({ mpg: 100.1 }), 'mpg'],
    ['tankGallons missing', withV({ tankGallons: undefined }), 'tankGallons'],
    ['tankGallons too low', withV({ tankGallons: 0.5 }), 'tankGallons'],
    ['tankGallons too high', withV({ tankGallons: 301 }), 'tankGallons'],
  ])('400 for %s', async (_label, body, word) => {
    const res = await put(body)
    expect(res.status).toBe(400)
    expect((res.jsonBody as { error: string }).error).toContain(word)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('accepts exactly 10 vehicles', async () => {
    const vehicles = Array.from({ length: 10 }, (_, i) => ({ ...v1, id: `v${i}` }))
    expect((await put({ garage: { vehicles, defaultVehicleId: 'v9' } })).status).toBe(200)
  })

  it('invalid JSON: 400', async () => {
    const res = await put('{nope')
    expect(res.status).toBe(400)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('413 by content-length header, nothing written', async () => {
    const res = await put({ garage }, { 'content-length': '16385' })
    expect(res.status).toBe(413)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('413 by body length, nothing written', async () => {
    const res = await put({ garage, pad: 'x'.repeat(16384) })
    expect(res.status).toBe(413)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('40613: 503', async () => {
    h.query.mockImplementation(unavailable)
    expect((await put({ garage })).status).toBe(503)
  })
})
