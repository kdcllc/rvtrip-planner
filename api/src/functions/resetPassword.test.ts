import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  query: vi.fn(),
  revoke: vi.fn(),
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
  return { DatabaseUnavailableError, query: h.query, sql: { NVarChar: () => ({}), UniqueIdentifier: {}, DateTimeOffset: {} } }
})
vi.mock('../shared/session', () => ({ revokeAllSessionsForUser: h.revoke }))
vi.mock('../shared/password', () => ({ hash: vi.fn(async () => 'scrypt$newhash') }))

import { DatabaseUnavailableError } from '../shared/db'
import { resetPassword } from './resetPassword'

process.env.APP_BASE_URL = 'https://app.example.com'

function mkReq(body: unknown, csrf = true) {
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
const good = { token: 'tok123', password: 'a-long-enough-password' }

/** Stateful fake of the token table + other statements. */
function fakeDb(expiresAt: Date) {
  const state = { used: false }
  h.query.mockImplementation(async (text: string) => {
    if (/^SELECT user_id/.test(text)) return { recordset: [{ user_id: 'u1', expires_at: expiresAt, used: state.used }] }
    if (/UPDATE dbo\.password_reset_tokens/.test(text)) {
      if (state.used || expiresAt.getTime() <= Date.now()) return { recordset: [] }
      state.used = true
      return { recordset: [{ user_id: 'u1' }] }
    }
    return { recordset: [] }
  })
}

beforeEach(() => {
  h.query.mockReset()
  h.revoke.mockReset()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('POST /api/reset-password', () => {
  it('registers a POST anonymous trigger', () => {
    expect(h.registered[0]).toMatchObject({
      name: 'resetPassword',
      opts: { route: 'reset-password', methods: ['POST'] },
    })
  })

  it('success: sets new hash, marks token used, revokes all sessions for the user', async () => {
    fakeDb(new Date('2026-01-01T00:30:00Z'))
    const res = await resetPassword(mkReq(good))
    expect(res.status).toBe(200)
    const pw = h.query.mock.calls.find((c) => /UPDATE dbo\.users/.test(c[0]))!
    expect(pw[1].passwordHash.value).toBe('scrypt$newhash')
    expect(h.query.mock.calls.some((c) => /SET used = 1/.test(c[0]))).toBe(true)
    expect(h.revoke).toHaveBeenCalledTimes(1)
    expect(h.revoke).toHaveBeenCalledWith('u1')
  })

  it('a token cannot be used twice', async () => {
    fakeDb(new Date('2026-01-01T00:30:00Z'))
    expect((await resetPassword(mkReq(good))).status).toBe(200)
    const second = await resetPassword(mkReq(good))
    expect(second.status).toBe(400)
    expect(h.revoke).toHaveBeenCalledTimes(1)
  })

  it('an expired token fails (fake timers)', async () => {
    fakeDb(new Date('2026-01-01T00:30:00Z'))
    vi.setSystemTime(new Date('2026-01-01T00:30:01Z'))
    const res = await resetPassword(mkReq(good))
    expect(res.status).toBe(400)
    expect(h.revoke).not.toHaveBeenCalled()
    expect(h.query.mock.calls.some((c) => /UPDATE dbo\.users/.test(c[0]))).toBe(false)
  })

  it('unknown token: same generic error as expired/used', async () => {
    h.query.mockResolvedValue({ recordset: [] })
    const unknown = await resetPassword(mkReq(good))
    fakeDb(new Date('2025-12-31T00:00:00Z'))
    const expired = await resetPassword(mkReq(good))
    expect(unknown.status).toBe(400)
    expect(JSON.stringify(unknown)).toBe(JSON.stringify(expired))
  })

  it('weak password: 400, token not consumed', async () => {
    const res = await resetPassword(mkReq({ token: 'tok123', password: 'short' }))
    expect(res.status).toBe(400)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('looks the token up by exact primary key with parameters (no LIKE)', async () => {
    h.query.mockResolvedValue({ recordset: [] })
    await resetPassword(mkReq(good))
    const [text, params] = h.query.mock.calls[0]
    expect(text).toMatch(/WHERE token = @token/)
    expect(text).not.toMatch(/LIKE/i)
    expect(params.token.value).toBe('tok123')
  })

  it('CSRF failure 403; bad JSON 400; no queries', async () => {
    expect((await resetPassword(mkReq(good, false))).status).toBe(403)
    expect((await resetPassword(mkReq('BAD'))).status).toBe(400)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('40613 uses the shared 503 path', async () => {
    h.query.mockRejectedValue(new DatabaseUnavailableError())
    const res = await resetPassword(mkReq(good))
    expect(res.status).toBe(503)
  })
})
