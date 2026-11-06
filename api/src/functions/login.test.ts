import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  query: vi.fn(),
  verify: vi.fn(),
  registered: [] as Array<{ name: string; opts: Record<string, unknown> }>,
}))
vi.mock('mssql', () => ({ default: {} }))
vi.mock('@azure/functions', () => ({
  app: { http: (name: string, opts: Record<string, unknown>) => h.registered.push({ name, opts }) },
}))
vi.mock('../shared/db', () => {
  class DatabaseUnavailableError extends Error {
    readonly code = 'DATABASE_UNAVAILABLE'
  }
  return {
    DatabaseUnavailableError,
    query: h.query,
    sql: { NVarChar: () => ({}), UniqueIdentifier: {}, DateTimeOffset: {}, Int: {} },
  }
})
vi.mock('../shared/session', () => ({
  createSession: vi.fn(async () => ({ token: 'tok', expiresAt: new Date(), maxAgeSeconds: 100 })),
}))
vi.mock('../shared/password', () => ({ verify: h.verify, verifyAgainstDummy: vi.fn(async () => false) }))

import { DatabaseUnavailableError } from '../shared/db'
import { login } from './login'

process.env.APP_BASE_URL = 'https://app.example.com'

function mkReq(body: unknown) {
  const headers: Record<string, string> = {
    origin: 'https://app.example.com',
    cookie: 'csrf_token=abc',
    'x-csrf-token': 'abc',
  }
  return {
    method: 'POST',
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    json: async () => {
      if (body === 'BAD') throw new Error('bad')
      return body
    },
  } as never
}
const creds = { email: 'Me@Example.com', password: 'whatever-password' }
const userRow = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  email: 'me@example.com',
  password_hash: 'scrypt$x',
  failed_attempts: 0,
  locked_until: null,
  ...over,
})

beforeEach(() => {
  h.query.mockReset()
  h.verify.mockReset()
})

describe('POST /api/login', () => {
  it('registers a POST anonymous trigger', () => {
    expect(h.registered[0]).toMatchObject({ name: 'login', opts: { route: 'login', methods: ['POST'] } })
  })

  it('unknown email, wrong password and locked account are byte-identical', async () => {
    h.query.mockResolvedValueOnce({ recordset: [] })
    const unknown = await login(mkReq(creds))

    h.query.mockReset()
    h.query.mockResolvedValueOnce({ recordset: [userRow()] }).mockResolvedValue({ recordset: [] })
    h.verify.mockResolvedValue(false)
    const wrong = await login(mkReq(creds))

    h.query.mockReset()
    h.query
      .mockResolvedValueOnce({ recordset: [userRow({ locked_until: new Date(Date.now() + 600000) })] })
      .mockResolvedValue({ recordset: [] })
    h.verify.mockResolvedValue(true) // even the right password must not get in while locked
    const locked = await login(mkReq(creds))

    for (const r of [wrong, locked]) {
      expect(r.status).toBe(unknown.status)
      expect(JSON.stringify(r.jsonBody)).toBe(JSON.stringify(unknown.jsonBody))
      expect(r.cookies).toBeUndefined()
    }
    expect(unknown.status).toBe(401)
  })

  it('locked account: no session, no counter update', async () => {
    h.query.mockResolvedValueOnce({ recordset: [userRow({ locked_until: new Date(Date.now() + 600000) })] })
    h.verify.mockResolvedValue(true)
    await login(mkReq(creds))
    expect(h.query).toHaveBeenCalledTimes(1)
  })

  it('wrong password increments failed_attempts with a lockout threshold, parameterised', async () => {
    h.query.mockResolvedValueOnce({ recordset: [userRow()] }).mockResolvedValue({ recordset: [] })
    h.verify.mockResolvedValue(false)
    await login(mkReq(creds))
    const [text, params] = h.query.mock.calls[1]
    expect(text).toContain('failed_attempts + 1')
    expect(text).toContain('locked_until')
    expect(params.max.value).toBe(5)
    expect(params.lockUntil.value.getTime()).toBeGreaterThan(Date.now())
  })

  it('success: resets failed_attempts, sets session + csrf cookies, returns id/email only', async () => {
    h.query
      .mockResolvedValueOnce({ recordset: [userRow({ failed_attempts: 3 })] })
      .mockResolvedValue({ recordset: [] })
    h.verify.mockResolvedValue(true)
    const res = await login(mkReq(creds))
    expect(res.status).toBe(200)
    expect(res.jsonBody).toEqual({ user: { id: 'u1', email: 'me@example.com', isAdmin: false } })
    expect(h.query.mock.calls[1][0]).toContain('failed_attempts = 0')
    expect((res.cookies as Array<{ name: string }>).map((c) => c.name)).toEqual(['session', 'csrf_token'])
  })

  it('lookup is by normalised email', async () => {
    h.query.mockResolvedValueOnce({ recordset: [] })
    await login(mkReq(creds))
    expect(h.query.mock.calls[0][1].email.value).toBe('me@example.com')
  })

  it('missing CSRF: 403; bad JSON: 400', async () => {
    const noCsrf = { method: 'POST', headers: { get: () => null }, json: async () => creds } as never
    expect((await login(noCsrf)).status).toBe(403)
    expect((await login(mkReq('BAD'))).status).toBe(400)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('40613: 503 with Retry-After, single attempt', async () => {
    h.query.mockRejectedValue(new DatabaseUnavailableError())
    const res = await login(mkReq(creds))
    expect(res.status).toBe(503)
    expect(h.query).toHaveBeenCalledTimes(1)
  })
})
