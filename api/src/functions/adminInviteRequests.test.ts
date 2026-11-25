import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  query: vi.fn(),
  requireAdmin: vi.fn(),
  issue: vi.fn(),
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
  return { DatabaseUnavailableError, query: h.query, sql: { UniqueIdentifier: {}, NVarChar: () => ({}) } }
})
vi.mock('../shared/admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('../shared/inviteCodes', () => ({
  issueInviteCode: h.issue,
  revokeUnusedInviteCodes: h.revokeAll,
}))
vi.mock('../shared/email', () => ({
  buildInviteLink: (c: string) => `https://app.example.com/?invite=${c}`,
  sendInviteEmail: h.sendInviteEmail,
}))

import { createInvite, declineInvite, listInviteRequests, sendInvite } from './adminInviteRequests'

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

function mkReq(opts: { id?: string; csrf?: boolean; body?: unknown; badJson?: boolean } = {}) {
  const csrf = opts.csrf ?? true
  const headers: Record<string, string> = csrf
    ? { origin: 'https://app.example.com', cookie: 'csrf_token=abc', 'x-csrf-token': 'abc' }
    : {}
  return {
    method: 'POST',
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    params: { id: opts.id ?? ID },
    json: async () => {
      if (opts.badJson) throw new SyntaxError('bad')
      return opts.body
    },
  } as never
}

beforeEach(() => {
  for (const f of [h.query, h.requireAdmin, h.issue, h.revokeAll, h.sendInviteEmail]) f.mockReset()
  h.requireAdmin.mockResolvedValue(ADMIN)
  h.issue.mockResolvedValue({ code: 'plain-code', expiresAt: new Date('2026-03-15T00:00:00Z') })
  h.sendInviteEmail.mockResolvedValue({ ok: true })
})

describe('registration', () => {
  it('registers GET list and POST create/invite/decline routes', () => {
    const routes = h.registered.map((r) => `${(r.opts.methods as string[])[0]} ${r.opts.route}`)
    expect(routes).toEqual([
      'GET manage/invite-requests',
      'POST manage/invites',
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
    expect((await createInvite(mkReq({ body: { email: 'n@x.y' } }))).status).toBe(denial.status)
    expect((await declineInvite(mkReq())).status).toBe(denial.status)
    expect(h.query).not.toHaveBeenCalled()
    expect(h.issue).not.toHaveBeenCalled()
  })

  it('mutations reject CSRF failures', async () => {
    expect((await sendInvite(mkReq({ csrf: false }))).status).toBe(403)
    expect((await createInvite(mkReq({ csrf: false, body: { email: 'n@x.y' } }))).status).toBe(403)
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
    expect(res.jsonBody).toMatchObject({ inviteLink: 'https://app.example.com/?invite=plain-code', emailSent: true })
  })

  it('email failure: 200 emailSent false, link returned, code not revoked, status updated', async () => {
    h.query
      .mockResolvedValueOnce({ recordset: [row()] })
      .mockResolvedValueOnce({ recordset: [row({ status: 'invited', invite_count: 1 })] })
    h.sendInviteEmail.mockResolvedValue({ ok: false, retryable: true })
    const res = await sendInvite(mkReq())
    expect(res.status).toBe(200)
    expect(res.jsonBody).toMatchObject({
      request: { status: 'invited' },
      inviteLink: 'https://app.example.com/?invite=plain-code',
      emailSent: false,
    })
    expect(h.query).toHaveBeenCalledTimes(2)
  })

  it('resend issues a fresh code (issueInviteCode revokes the previous ones)', async () => {
    h.query.mockResolvedValue({ recordset: [row({ status: 'invited' })] })
    await sendInvite(mkReq())
    await sendInvite(mkReq())
    expect(h.issue).toHaveBeenCalledTimes(2)
  })
})

describe('POST create invite', () => {
  type Cfg = { user?: boolean; byEmail?: unknown[]; insertError?: unknown; insertRow?: unknown }
  const setup = (cfg: Cfg = {}) => {
    h.query.mockImplementation(async (text: string) => {
      if (/^SELECT id FROM dbo\.users/.test(text)) return { recordset: cfg.user ? [{ id: 'u' }] : [] }
      if (/FROM dbo\.invite_requests WHERE email/.test(text)) {
        const rows = cfg.byEmail ?? []
        return { recordset: rows.length ? [rows[0]] : [] }
      }
      if (/^INSERT INTO dbo\.invite_requests/.test(text)) {
        if (cfg.insertError) {
          if (cfg.byEmail && cfg.byEmail.length > 1) cfg.byEmail.shift()
          throw cfg.insertError
        }
        return { recordset: [cfg.insertRow ?? row({ email: 'new@x.y', name: 'new' })] }
      }
      if (/^UPDATE dbo\.invite_requests/.test(text)) {
        return { recordset: [row({ status: 'invited', invite_count: 1, invited_at: new Date('2026-03-01T00:00:00Z') })] }
      }
      throw new Error(`unexpected: ${text.slice(0, 40)}`)
    })
  }
  const inserts = () => h.query.mock.calls.filter((c) => /^INSERT INTO dbo\.invite_requests/.test(c[0] as string))
  const call = (body: unknown) => createInvite(mkReq({ body }))

  it('400 invalid JSON, non-object body, bad emails and bad names; nothing issued', async () => {
    setup()
    expect((await createInvite(mkReq({ badJson: true }))).jsonBody).toEqual({ error: 'Invalid JSON' })
    expect((await call(null)).status).toBe(400)
    for (const email of [undefined, 5, '', 'nope', 'a@b', 'a b@c.d', `${'a'.repeat(320)}@x.y`]) {
      const res = await call({ email })
      expect(res.status).toBe(400)
      expect(res.jsonBody).toEqual({ error: 'Invalid email address' })
    }
    for (const name of [5, {}, 'n'.repeat(201)]) {
      const res = await call({ email: 'new@x.y', name })
      expect(res.status).toBe(400)
      expect(res.jsonBody).toEqual({ error: 'Invalid name' })
    }
    expect(h.query).not.toHaveBeenCalled()
    expect(h.issue).not.toHaveBeenCalled()
  })

  it('409 when a users row exists', async () => {
    setup({ user: true })
    expect((await call({ email: 'new@x.y' })).status).toBe(409)
    expect(inserts()).toHaveLength(0)
    expect(h.issue).not.toHaveBeenCalled()
  })

  it('409 when the existing request is registered', async () => {
    setup({ byEmail: [row({ status: 'registered' })] })
    expect((await call({ email: 'p@x.y' })).status).toBe(409)
    expect(h.issue).not.toHaveBeenCalled()
  })

  it('new address: inserts pending, returns link once, emails, emailSent true', async () => {
    setup()
    const res = await call({ email: '  New@X.Y ', name: ' Nia ' })
    expect(res.status).toBe(200)
    const [text, params] = inserts()[0] as [string, Record<string, { value: unknown }>]
    expect(text).toContain("'pending'")
    expect(params.email.value).toBe('new@x.y')
    expect(params.name.value).toBe('Nia')
    expect(h.issue).toHaveBeenCalledWith(ID)
    expect(h.sendInviteEmail).toHaveBeenCalledWith('new@x.y', 'new', 'https://app.example.com/?invite=plain-code', new Date('2026-03-15T00:00:00Z'))
    expect(res.jsonBody).toMatchObject({
      request: { status: 'invited', inviteCount: 1 },
      inviteLink: 'https://app.example.com/?invite=plain-code',
      emailSent: true,
    })
  })

  it('blank or missing name defaults to the email local part (max 200)', async () => {
    setup()
    await call({ email: 'dana@x.y' })
    await call({ email: 'lee@x.y', name: '   ' })
    await call({ email: `${'l'.repeat(250)}@x.y` })
    const names = inserts().map((c) => (c[1] as Record<string, { value: string }>).name.value)
    expect(names).toEqual(['dana', 'lee', 'l'.repeat(200)])
  })

  it.each(['pending', 'declined', 'invited'])('existing %s request is reused with no INSERT', async (status) => {
    setup({ byEmail: [row({ status })] })
    const res = await call({ email: 'p@x.y', name: 'Other' })
    expect(res.status).toBe(200)
    expect(inserts()).toHaveLength(0)
    expect(h.issue).toHaveBeenCalledWith(ID)
  })

  it.each([2627, 2601])('unique violation %s re-selects by email and continues', async (number) => {
    setup({ byEmail: [undefined, row()] as unknown[], insertError: Object.assign(new Error('dup'), { number }) })
    const res = await call({ email: 'p@x.y' })
    expect(res.status).toBe(200)
    expect(inserts()).toHaveLength(1)
    expect(h.issue).toHaveBeenCalledWith(ID)
  })

  it('unique violation then registered request is 409; other insert errors are 500', async () => {
    setup({ byEmail: [undefined, row({ status: 'registered' })] as unknown[], insertError: { number: 2627 } })
    expect((await call({ email: 'p@x.y' })).status).toBe(409)
    setup({ insertError: new Error('boom') })
    expect((await call({ email: 'p@x.y' })).status).toBe(500)
  })

  it('email failure: 200 emailSent false, code not revoked', async () => {
    setup()
    h.sendInviteEmail.mockResolvedValue({ ok: false, retryable: false })
    const res = await call({ email: 'new@x.y' })
    expect(res.status).toBe(200)
    expect(res.jsonBody).toMatchObject({ emailSent: false, inviteLink: 'https://app.example.com/?invite=plain-code' })
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
