import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  query: vi.fn(),
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
  return { DatabaseUnavailableError, query: h.query, sql: { NVarChar: () => ({}), Char: () => ({}), UniqueIdentifier: {}, DateTimeOffset: {} } }
})
vi.mock('../shared/session', () => ({
  createSession: vi.fn(async () => ({ token: 'tok', expiresAt: new Date(), maxAgeSeconds: 100 })),
}))
vi.mock('../shared/password', () => ({ hash: vi.fn(async () => 'scrypt$hashed') }))

import { DatabaseUnavailableError } from '../shared/db'
import { hashInviteCode } from '../shared/inviteCodes'
import { register } from './register'

process.env.APP_BASE_URL = 'https://app.example.com'
process.env.INVITE_CODE = 'let-me-in'

function mkReq(body: unknown, opts: { csrf?: boolean } = {}) {
  const csrf = opts.csrf ?? true
  const headers: Record<string, string> = csrf
    ? { origin: 'https://app.example.com', cookie: 'csrf_token=abc', 'x-csrf-token': 'abc' }
    : {}
  return {
    method: 'POST',
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    json: async () => {
      if (body === 'BAD') throw new Error('bad json')
      return body
    },
  } as never
}
const good = { email: 'Me@Example.com', password: 'a-long-enough-password', inviteCode: 'let-me-in' }

beforeEach(() => {
  h.query.mockReset()
})

describe('POST /api/register', () => {
  it('registers a POST anonymous trigger', () => {
    expect(h.registered[0]).toMatchObject({ name: 'register', opts: { route: 'register', methods: ['POST'] } })
  })

  it.each([[undefined], ['']])('invite code %j: 403 and no query', async (inviteCode) => {
    const res = await register(mkReq({ ...good, inviteCode }))
    expect(res.status).toBe(403)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('unknown single-use code: batch returns NULL id -> 403, no session', async () => {
    h.query.mockResolvedValue({ recordset: [{ id: null }] })
    const res = await register(mkReq({ ...good, inviteCode: 'wrong' }))
    expect(res.status).toBe(403)
    expect(res.cookies).toBeUndefined()
  })

  it('single-use code: one atomic batch, only the hash is sent, 201 with isAdmin', async () => {
    h.query.mockResolvedValue({ recordset: [{ id: 'u9' }] })
    const res = await register(mkReq({ ...good, inviteCode: 'plain-single-use-code' }))
    expect(res.status).toBe(201)
    expect(res.jsonBody).toEqual({ user: { id: 'u9', email: 'me@example.com', isAdmin: false } })
    expect(h.query).toHaveBeenCalledTimes(1)
    const [text, params] = h.query.mock.calls[0]
    expect(text).toContain('BEGIN TRAN')
    expect(text).toContain("status = 'registered'")
    expect(params.codeHash.value).toBe(hashInviteCode('plain-single-use-code'))
    expect(JSON.stringify(Object.values(params).map((p) => (p as { value: unknown }).value))).not.toContain('plain-single-use-code')
  })

  it('single-use code + duplicate email (2627): generic 400, no session', async () => {
    h.query.mockRejectedValue(Object.assign(new Error('dup'), { number: 2627 }))
    const res = await register(mkReq({ ...good, inviteCode: 'some-code' }))
    expect(res.status).toBe(400)
    expect(res.cookies).toBeUndefined()
  })

  it('rejects CSRF failures before anything else', async () => {
    const res = await register(mkReq(good, { csrf: false }))
    expect(res.status).toBe(403)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('400 on bad email, short password, bad JSON; no insert', async () => {
    expect((await register(mkReq({ ...good, email: 'nope' }))).status).toBe(400)
    expect((await register(mkReq({ ...good, password: 'short' }))).status).toBe(400)
    expect((await register(mkReq('BAD'))).status).toBe(400)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('success: inserts normalised email + hash, 201, session and csrf cookies, no hash in body', async () => {
    h.query.mockResolvedValue({ recordset: [{ id: 'u1' }] })
    const res = await register(mkReq(good))
    expect(res.status).toBe(201)
    expect(res.jsonBody).toEqual({ user: { id: 'u1', email: 'me@example.com', isAdmin: false } })
    const [text, params] = h.query.mock.calls[0]
    expect(text).toContain('INSERT INTO dbo.users')
    expect(params.email.value).toBe('me@example.com')
    expect(params.passwordHash.value).toBe('scrypt$hashed')
    const names = (res.cookies as Array<{ name: string }>).map((c) => c.name)
    expect(names).toEqual(['session', 'csrf_token'])
  })

  it('duplicate email (2627): generic 400, no cookies, nothing confirming existence', async () => {
    h.query.mockRejectedValue(Object.assign(new Error('dup'), { number: 2627 }))
    const res = await register(mkReq(good))
    expect(res.status).toBe(400)
    expect(JSON.stringify(res.jsonBody)).not.toMatch(/exist|already|duplicate/i)
    expect(res.cookies).toBeUndefined()
  })

  it('40613: 503 with Retry-After, single attempt', async () => {
    h.query.mockRejectedValue(new DatabaseUnavailableError())
    const res = await register(mkReq(good))
    expect(res.status).toBe(503)
    expect((res.headers as Record<string, string>)['Retry-After']).toBeDefined()
    expect(h.query).toHaveBeenCalledTimes(1)
  })

  it('unexpected error: 500 without SQL text', async () => {
    h.query.mockRejectedValue(new Error('SELECT secret FROM x'))
    const res = await register(mkReq(good))
    expect(res.status).toBe(500)
    expect(JSON.stringify(res.jsonBody)).not.toContain('SELECT')
  })
})
