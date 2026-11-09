import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  query: vi.fn(),
  requireAdmin: vi.fn(),
  issue: vi.fn(),
  revokeOne: vi.fn(),
  revokeAll: vi.fn(),
  sendInviteEmail: vi.fn(),
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
  return { DatabaseUnavailableError, query: h.query, sql: { UniqueIdentifier: {} } }
})
vi.mock('../shared/admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('../shared/inviteCodes', () => ({
  issueInviteCode: h.issue,
  revokeInviteCode: h.revokeOne,
  revokeUnusedInviteCodes: h.revokeAll,
}))
vi.mock('../shared/email', () => ({
  buildInviteLink: (c: string) => `https://app.example.com/?invite=${c}`,
  sendInviteEmail: h.sendInviteEmail,
}))

import { declineInvite, listInviteRequests, sendInvite } from './adminInviteRequests'

process.env.APP_BASE_URL = 'https://app.example.com'
const ID = '11111111-2222-3333-4444-555555555555'
const row = (over: Record<string, unknown> = {}) => ({
  id: ID,
  email: 'p@x.y',
  name: 'Pat',
  note: null,
  status: 'pending',
  created_at: new Date('2026-03-01T00:00:00Z'),
  invited_at: null,
  invite_count: 0,
  ...over,
})
const ADMIN = { id: 'a', email: 'a@x.y', isAdmin: true }

function mkReq(opts: { id?: string; csrf?: boolean } = {}) {
  const csrf = opts.csrf ?? true
  const headers: Record<string, string> = csrf
    ? { origin: 'https://app.example.com', cookie: 'csrf_token=abc', 'x-csrf-token': 'abc' }
    : {}
  return {
    method: 'POST',
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    params: { id: opts.id ?? ID },
  } as never
}

beforeEach(() => {
  for (const f of [h.query, h.requireAdmin, h.issue, h.revokeOne, h.revokeAll, h.sendInviteEmail]) f.mockReset()
  h.requireAdmin.mockResolvedValue(ADMIN)
  h.issue.mockResolvedValue({ code: 'plain-code', expiresAt: new Date('2026-03-15T00:00:00Z') })
  h.sendInviteEmail.mockResolvedValue({ ok: true })
})

describe('registration', () => {
  it('registers GET list and POST invite/decline routes', () => {
    const routes = h.registered.map((r) => `${(r.opts.methods as string[])[0]} ${r.opts.route}`)
    expect(routes).toEqual([
      'GET manage/invite-requests',
      'POST manage/invite-requests/{id}/invite',
      'POST manage/invite-requests/{id}/decline',
    ])
  })
})

describe('admin guard', () => {
  it.each([
    ['401', { status: 401, jsonBody: { error: 'Unauthorized' } }],
    ['403', { status: 403, jsonBody: { error: 'Forbidden' } }],
  ])('non-admin gets %s on every endpoint and nothing runs', async (_n, denial) => {
    h.requireAdmin.mockResolvedValue(denial)
    expect((await listInviteRequests(mkReq())).status).toBe(denial.status)
    expect((await sendInvite(mkReq())).status).toBe(denial.status)
    expect((await declineInvite(mkReq())).status).toBe(denial.status)
    expect(h.query).not.toHaveBeenCalled()
    expect(h.issue).not.toHaveBeenCalled()
  })

  it('mutations reject CSRF failures', async () => {
    expect((await sendInvite(mkReq({ csrf: false }))).status).toBe(403)
    expect((await declineInvite(mkReq({ csrf: false }))).status).toBe(403)
    expect(h.issue).not.toHaveBeenCalled()
  })
})

describe('GET list', () => {
  it('maps rows to DTOs, newest first query', async () => {
    h.query.mockResolvedValue({ recordset: [row({ invited_at: '2026-03-02T00:00:00Z', status: 'invited', invite_count: 1 })] })
    const res = await listInviteRequests(mkReq())
    expect(res.status).toBe(200)
    expect(h.query.mock.calls[0][0]).toMatch(/ORDER BY created_at DESC/)
    expect(res.jsonBody).toEqual({
      requests: [{
        id: ID, email: 'p@x.y', name: 'Pat', note: null, status: 'invited',
        createdAt: '2026-03-01T00:00:00.000Z', invitedAt: '2026-03-02T00:00:00.000Z', inviteCount: 1,
      }],
    })
  })
})

describe('POST invite', () => {
  it('400 malformed id, 404 unknown, 409 registered; no code issued', async () => {
    expect((await sendInvite(mkReq({ id: 'nope' }))).status).toBe(400)
    h.query.mockResolvedValueOnce({ recordset: [] })
    expect((await sendInvite(mkReq())).status).toBe(404)
    h.query.mockResolvedValueOnce({ recordset: [row({ status: 'registered' })] })
    expect((await sendInvite(mkReq())).status).toBe(409)
    expect(h.issue).not.toHaveBeenCalled()
  })

  it.each(['pending', 'invited', 'declined'])('works for %s: issues code, emails link, marks invited', async (status) => {
    h.query
      .mockResolvedValueOnce({ recordset: [row({ status })] })
      .mockResolvedValueOnce({ recordset: [row({ status: 'invited', invited_at: new Date('2026-03-01T00:00:00Z'), invite_count: 1 })] })
    const res = await sendInvite(mkReq())
    expect(res.status).toBe(200)
    expect(h.issue).toHaveBeenCalledWith(ID)
    expect(h.sendInviteEmail).toHaveBeenCalledWith('p@x.y', 'Pat', 'https://app.example.com/?invite=plain-code', new Date('2026-03-15T00:00:00Z'))
    const update = h.query.mock.calls[1][0] as string
    expect(update).toContain("status = 'invited'")
    expect(update).toContain('invite_count = invite_count + 1')
    expect(res.jsonBody).toMatchObject({ request: { status: 'invited', inviteCount: 1 } })
    expect(JSON.stringify(res.jsonBody)).not.toContain('plain-code')
  })

  it('email failure: revokes the new code, status untouched, 502 EMAIL_FAILED', async () => {
    h.query.mockResolvedValueOnce({ recordset: [row()] })
    h.sendInviteEmail.mockResolvedValue({ ok: false, retryable: true })
    const res = await sendInvite(mkReq())
    expect(res.status).toBe(502)
    expect(res.jsonBody).toEqual({ error: 'Email could not be sent', code: 'EMAIL_FAILED' })
    expect(h.revokeOne).toHaveBeenCalledWith('plain-code')
    expect(h.query).toHaveBeenCalledTimes(1) // only the lookup; no status update
  })

  it('resend issues a fresh code (issueInviteCode revokes the previous ones)', async () => {
    h.query.mockResolvedValue({ recordset: [row({ status: 'invited' })] })
    await sendInvite(mkReq())
    await sendInvite(mkReq())
    expect(h.issue).toHaveBeenCalledTimes(2)
  })
})

describe('POST decline', () => {
  it('400 / 404 / 409 paths', async () => {
    expect((await declineInvite(mkReq({ id: 'x' }))).status).toBe(400)
    h.query.mockResolvedValueOnce({ recordset: [] })
    expect((await declineInvite(mkReq())).status).toBe(404)
    h.query.mockResolvedValueOnce({ recordset: [row({ status: 'registered' })] })
    expect((await declineInvite(mkReq())).status).toBe(409)
    expect(h.revokeAll).not.toHaveBeenCalled()
  })

  it('sets declined and revokes unused codes', async () => {
    h.query
      .mockResolvedValueOnce({ recordset: [row({ status: 'invited' })] })
      .mockResolvedValueOnce({ recordset: [row({ status: 'declined' })] })
    const res = await declineInvite(mkReq())
    expect(res.status).toBe(200)
    expect(h.revokeAll).toHaveBeenCalledWith(ID)
    expect(h.query.mock.calls[1][0]).toContain("status = 'declined'")
    expect(res.jsonBody).toMatchObject({ request: { status: 'declined' } })
  })

  it('409 when the request registers between lookup and update', async () => {
    h.query.mockResolvedValueOnce({ recordset: [row()] }).mockResolvedValueOnce({ recordset: [] })
    expect((await declineInvite(mkReq())).status).toBe(409)
  })
})
