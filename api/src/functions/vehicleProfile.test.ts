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
import { getVehicleProfile, putVehicleProfile } from './vehicleProfile'

const USER = { id: 'u1', email: 'a@b.c' }
const profile = { name: 'Rig', fuelType: 'diesel', mpg: 9.5, tankGallons: 80 }

const getReq = { method: 'GET', headers: { get: () => null } } as never
function mk(body?: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { method: 'PUT', headers: { get: () => null }, text: async () => text } as never
}
const put = (body: unknown) => putVehicleProfile(mk(body))
const withProfile = (patch: Record<string, unknown>) => ({ profile: { ...profile, ...patch } })
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
  it('registers GET and PUT on vehicle-profile', () => {
    expect(h.registered.map((r) => [r.name, r.opts.route, r.opts.methods, r.opts.authLevel])).toEqual([
      ['getVehicleProfile', 'vehicle-profile', ['GET'], 'anonymous'],
      ['putVehicleProfile', 'vehicle-profile', ['PUT'], 'anonymous'],
    ])
  })
})

describe('GET /api/vehicle-profile', () => {
  it('no session: 401, no query', async () => {
    h.validate.mockResolvedValue(null)
    const res = await getVehicleProfile(getReq)
    expect(res.status).toBe(401)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('returns the parsed profile for the session user', async () => {
    h.query.mockResolvedValue({ recordset: [{ data: JSON.stringify(profile) }] })
    const res = await getVehicleProfile(getReq)
    expect(res.status).toBe(200)
    expect(res.jsonBody).toEqual({ profile })
    const [text, params] = h.query.mock.calls[0]
    expect(text).toMatch(/WHERE user_id = @userId/)
    expect(params.userId.value).toBe('u1')
  })

  it('no row: profile null', async () => {
    const res = await getVehicleProfile(getReq)
    expect(res.status).toBe(200)
    expect(res.jsonBody).toEqual({ profile: null })
  })

  it('40613: 503', async () => {
    h.query.mockImplementation(unavailable)
    expect((await getVehicleProfile(getReq)).status).toBe(503)
  })
})

describe('PUT /api/vehicle-profile', () => {
  it('no session: 401, no query', async () => {
    h.validate.mockResolvedValue(null)
    const res = await put({ profile })
    expect(res.status).toBe(401)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('CSRF failure: 403, no query', async () => {
    h.csrf.mockReturnValue({ status: 403, jsonBody: { error: 'CSRF' } })
    const res = await put({ profile })
    expect(res.status).toBe(403)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('stores the trimmed name, drops extra fields, upserts for the session user', async () => {
    const res = await put({
      profile: { ...profile, name: '  Rig  ', extra: 'x' },
      other: 1,
    })
    const stored = { name: 'Rig', fuelType: 'diesel', mpg: 9.5, tankGallons: 80 }
    expect(res.status).toBe(200)
    expect(res.jsonBody).toEqual({ profile: stored })
    const [text, params] = h.query.mock.calls[0]
    expect(text).toMatch(/MERGE dbo\.vehicle_profiles/)
    expect(text).toMatch(/updated_at = SYSUTCDATETIME\(\)/)
    expect(params.userId.value).toBe('u1')
    expect(JSON.parse(params.data.value)).toEqual(stored)
  })

  it('accepts an empty name and null tankGallons', async () => {
    const res = await put(withProfile({ name: '', tankGallons: null }))
    expect(res.status).toBe(200)
    expect(res.jsonBody).toEqual({ profile: { ...profile, name: '', tankGallons: null } })
  })

  it.each([
    ['body not an object', 'null', 'profile'],
    ['body an array', [], 'profile'],
    ['no profile', {}, 'profile'],
    ['profile not an object', { profile: 'x' }, 'profile'],
    ['name not a string', withProfile({ name: 5 }), 'name'],
    ['name too long', withProfile({ name: 'a'.repeat(81) }), 'name'],
    ['bad fuelType', withProfile({ fuelType: 'propane' }), 'fuelType'],
    ['mpg string', withProfile({ mpg: '9' }), 'mpg'],
    ['mpg NaN-like null', withProfile({ mpg: null }), 'mpg'],
    ['mpg too low', withProfile({ mpg: 4.9 }), 'mpg'],
    ['mpg too high', withProfile({ mpg: 100.1 }), 'mpg'],
    ['tankGallons missing', withProfile({ tankGallons: undefined }), 'tankGallons'],
    ['tankGallons too low', withProfile({ tankGallons: 0.5 }), 'tankGallons'],
    ['tankGallons too high', withProfile({ tankGallons: 301 }), 'tankGallons'],
    ['tankGallons string', withProfile({ tankGallons: '80' }), 'tankGallons'],
  ])('400 for %s', async (_label, body, field) => {
    const res = await put(body)
    expect(res.status).toBe(400)
    expect((res.jsonBody as { error: string }).error).toContain(field)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('invalid JSON: 400', async () => {
    const res = await put('{nope')
    expect(res.status).toBe(400)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('accepts boundary values', async () => {
    expect((await put(withProfile({ mpg: 5, tankGallons: 1 }))).status).toBe(200)
    expect((await put(withProfile({ mpg: 100, tankGallons: 300, name: 'a'.repeat(80) }))).status).toBe(200)
  })

  it('40613: 503', async () => {
    h.query.mockImplementation(unavailable)
    expect((await put({ profile })).status).toBe(503)
  })
})
