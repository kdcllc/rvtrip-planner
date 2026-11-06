import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  query: vi.fn(),
  notify: vi.fn(),
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
    sql: { NVarChar: () => ({}), Char: () => ({}) },
  }
})
vi.mock('../shared/email', () => ({ sendInviteRequestNotification: h.notify }))

import { DatabaseUnavailableError } from '../shared/db'
import { inviteRequests } from './inviteRequests'

process.env.APP_BASE_URL = 'https://app.example.com'
process.env.SESSION_SECRET = 'salt'

function mkReq(body: unknown, opts: { csrf?: boolean; headers?: Record<string, string> } = {}) {
  const csrf = opts.csrf ?? true
  const headers: Record<string, string> = {
    ...(csrf ? { origin: 'https://app.example.com', cookie: 'csrf_token=abc', 'x-csrf-token': 'abc' } : {}),
    ...(opts.headers ?? {}),
  }
  return {
    method: 'POST',
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    json: async () => {
      if (body === 'BAD') throw new Error('bad json')
      return body
    },
  } as never
}
const good = { email: 'New@Example.com', name: ' Ann ', note: 'hi' }
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

/** recent count, existing rows, then insert. */
function dbReturns(recent = 0, existing: unknown[] = []) {
  h.query
    .mockResolvedValueOnce({ recordset: [{ n: recent }] })
    .mockResolvedValueOnce({ recordset: existing })
    .mockResolvedValue({ recordset: [] })
}

beforeEach(() => {
  h.query.mockReset()
  h.notify.mockReset()
  h.notify.mockResolvedValue({ ok: true })
  process.env.ADMIN_EMAILS = 'a1@x.co,a2@x.co'
})

describe('POST /api/invite-requests', () => {
  it('registers an anonymous POST trigger', () => {
    expect(h.registered[0]).toMatchObject({
      name: 'inviteRequests',
      opts: { route: 'invite-requests', methods: ['POST'], authLevel: 'anonymous' },
    })
  })

  it('rejects CSRF failures first', async () => {
    expect((await inviteRequests(mkReq(good, { csrf: false }))).status).toBe(403)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('400 on invalid JSON', async () => {
    expect((await inviteRequests(mkReq('BAD'))).status).toBe(400)
  })

  it.each([
    ['bad email', { ...good, email: 'nope' }],
    ['long email', { ...good, email: `${'a'.repeat(320)}@x.co` }],
    ['empty name', { ...good, name: '   ' }],
    ['long name', { ...good, name: 'n'.repeat(201) }],
    ['long note', { ...good, note: 'n'.repeat(1001) }],
    ['non-string note', { ...good, note: 5 }],
  ])('400 for %s, no DB', async (_l, body) => {
    expect((await inviteRequests(mkReq(body))).status).toBe(400)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('honeypot: 200 ok, nothing stored or sent', async () => {
    const res = await inviteRequests(mkReq({ ...good, website: 'http://spam' }))
    expect(res).toMatchObject({ status: 200, jsonBody: { ok: true } })
    expect(h.query).not.toHaveBeenCalled()
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('stores a pending row with only the hashed IP, then emails every admin', async () => {
    dbReturns()
    const res = await inviteRequests(mkReq(good, { headers: { 'x-azure-clientip': '1.2.3.4' } }))
    expect(res).toMatchObject({ status: 200, jsonBody: { ok: true } })
    const [text, params] = h.query.mock.calls[2]
    expect(text).toContain('INSERT INTO dbo.invite_requests')
    expect(text).toContain("'pending'")
    expect(params.email.value).toBe('new@example.com')
    expect(params.name.value).toBe('Ann')
    expect(params.note.value).toBe('hi')
    expect(params.ipHash.value).toBe(sha('1.2.3.4salt'))
    for (const call of h.query.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('1.2.3.4')
    }
    expect(h.notify.mock.calls.map((c) => c[0])).toEqual(['a1@x.co', 'a2@x.co'])
    expect(h.notify.mock.calls[0][1]).toEqual({ name: 'Ann', email: 'new@example.com', note: 'hi' })
  })

  it('IP falls back to first x-forwarded-for entry, then "unknown"', async () => {
    dbReturns()
    await inviteRequests(mkReq(good, { headers: { 'x-forwarded-for': '9.9.9.9, 8.8.8.8' } }))
    expect(h.query.mock.calls[0][1].ipHash.value).toBe(sha('9.9.9.9salt'))
    h.query.mockReset()
    dbReturns()
    await inviteRequests(mkReq(good))
    expect(h.query.mock.calls[0][1].ipHash.value).toBe(sha('unknownsalt'))
  })

  it('empty note is stored as null', async () => {
    dbReturns()
    await inviteRequests(mkReq({ email: 'a@b.co', name: 'A' }))
    expect(h.query.mock.calls[2][1].note.value).toBeNull()
  })

  it('rate limit: 429 RATE_LIMITED once 5 requests exist in the last hour; nothing inserted', async () => {
    dbReturns(5)
    const res = await inviteRequests(mkReq(good))
    expect(res).toMatchObject({ status: 429, jsonBody: { code: 'RATE_LIMITED' } })
    expect(h.query).toHaveBeenCalledTimes(1)
    expect(h.query.mock.calls[0][0]).toContain('DATEADD(hour, -1')
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('4 prior requests still allowed', async () => {
    dbReturns(4)
    expect((await inviteRequests(mkReq(good))).status).toBe(200)
  })

  it('duplicate email: 200 ok, no insert, no email', async () => {
    dbReturns(0, [{ x: 1 }])
    const res = await inviteRequests(mkReq(good))
    expect(res).toMatchObject({ status: 200, jsonBody: { ok: true } })
    expect(h.query).toHaveBeenCalledTimes(2)
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('duplicate-key race on insert: 200 ok, no email', async () => {
    h.query
      .mockResolvedValueOnce({ recordset: [{ n: 0 }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { number: 2627 }))
    expect((await inviteRequests(mkReq(good))).status).toBe(200)
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('email failure (result or throw) is logged and still 200, row kept', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    dbReturns()
    h.notify.mockResolvedValueOnce({ ok: false, retryable: true }).mockRejectedValueOnce(new Error('boom'))
    const res = await inviteRequests(mkReq(good))
    expect(res).toMatchObject({ status: 200, jsonBody: { ok: true } })
    expect(h.notify).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('no admins configured: stores the row, sends nothing', async () => {
    delete process.env.ADMIN_EMAILS
    dbReturns()
    expect((await inviteRequests(mkReq(good))).status).toBe(200)
    expect(h.query).toHaveBeenCalledTimes(3)
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('DB waking maps to 503; other errors to a safe 500', async () => {
    h.query.mockRejectedValueOnce(new DatabaseUnavailableError())
    expect((await inviteRequests(mkReq(good))).status).toBe(503)
    h.query.mockRejectedValueOnce(new Error('SELECT secret FROM x'))
    const res = await inviteRequests(mkReq(good))
    expect(res).toMatchObject({ status: 500, jsonBody: { error: 'Internal server error' } })
  })
})
