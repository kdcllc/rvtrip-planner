import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  query: vi.fn(),
  send: vi.fn(),
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
vi.mock('../shared/email', () => ({
  buildResetLink: (t: string) => `https://app.example.com/reset-password?token=${t}`,
  sendPasswordResetEmail: h.send,
}))

import { DatabaseUnavailableError } from '../shared/db'
import { forgotPassword } from './forgotPassword'

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

beforeEach(() => {
  h.query.mockReset()
  h.send.mockReset()
  h.send.mockResolvedValue({ ok: true })
})

describe('POST /api/forgot-password', () => {
  it('registers a POST anonymous trigger', () => {
    expect(h.registered[0]).toMatchObject({
      name: 'forgotPassword',
      opts: { route: 'forgot-password', methods: ['POST'] },
    })
  })

  it('known and unknown email return byte-identical status and body', async () => {
    h.query.mockResolvedValueOnce({ recordset: [{ id: 'u1' }] }).mockResolvedValue({ recordset: [] })
    const known = await forgotPassword(mkReq({ email: 'me@example.com' }))
    h.query.mockReset()
    h.query.mockResolvedValue({ recordset: [] })
    const unknown = await forgotPassword(mkReq({ email: 'nobody@example.com' }))
    expect(known.status).toBe(200)
    expect(JSON.stringify(known)).toBe(JSON.stringify(unknown))
  })

  it('invalid email / bad JSON also return the same 200 and touch nothing', async () => {
    const a = await forgotPassword(mkReq({ email: 'nope' }))
    const b = await forgotPassword(mkReq('BAD'))
    expect(a.status).toBe(200)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(h.query).not.toHaveBeenCalled()
  })

  it('existing account: supersedes old tokens, stores >=32-byte token with used=0 and <=1h expiry, emails link', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    try {
      h.query.mockResolvedValueOnce({ recordset: [{ id: 'u1' }] }).mockResolvedValue({ recordset: [] })
      await forgotPassword(mkReq({ email: 'Me@Example.com' }))
      expect(h.query.mock.calls[0][1].email.value).toBe('me@example.com')
      expect(h.query.mock.calls[1][0]).toMatch(/UPDATE dbo\.password_reset_tokens SET used = 1/)
      const [insertSql, p] = h.query.mock.calls[2]
      expect(insertSql).toMatch(/INSERT INTO dbo\.password_reset_tokens/)
      expect(insertSql).toMatch(/, 0\)/)
      expect(Buffer.from(p.token.value, 'base64url').length).toBeGreaterThanOrEqual(32)
      const ttl = p.expiresAt.value.getTime() - Date.now()
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(3600_000)
      expect(h.send).toHaveBeenCalledWith('me@example.com', expect.stringContaining(p.token.value))
    } finally {
      vi.useRealTimers()
    }
  })

  it('ACS failure (even 429) does not change the response', async () => {
    h.query.mockResolvedValueOnce({ recordset: [{ id: 'u1' }] }).mockResolvedValue({ recordset: [] })
    const ok = await forgotPassword(mkReq({ email: 'me@example.com' }))
    h.query.mockReset()
    h.query.mockResolvedValueOnce({ recordset: [{ id: 'u1' }] }).mockResolvedValue({ recordset: [] })
    h.send.mockResolvedValue({ ok: false, retryable: true })
    const failed = await forgotPassword(mkReq({ email: 'me@example.com' }))
    expect(JSON.stringify(failed)).toBe(JSON.stringify(ok))
  })

  it('link-build failure (e.g. missing APP_BASE_URL) returns the same 200 as an unknown email', async () => {
    h.query.mockResolvedValueOnce({ recordset: [] })
    const unknown = await forgotPassword(mkReq({ email: 'nobody@example.com' }))
    h.query.mockReset()
    h.query.mockResolvedValueOnce({ recordset: [{ id: 'u1' }] }).mockResolvedValue({ recordset: [] })
    h.send.mockImplementation(() => {
      throw new Error('APP_BASE_URL is not configured')
    })
    const res = await forgotPassword(mkReq({ email: 'me@example.com' }))
    expect(res.status).toBe(200)
    expect(JSON.stringify(res)).toBe(JSON.stringify(unknown))
  })

  it('CSRF failure is 403 with no queries', async () => {
    expect((await forgotPassword(mkReq({ email: 'me@example.com' }, false))).status).toBe(403)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('40613 uses the shared 503 path', async () => {
    h.query.mockRejectedValue(new DatabaseUnavailableError())
    const res = await forgotPassword(mkReq({ email: 'me@example.com' }))
    expect(res.status).toBe(503)
    expect((res.headers as Record<string, string>)['Retry-After']).toBeDefined()
  })
})
