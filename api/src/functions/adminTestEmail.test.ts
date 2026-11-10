import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  sendTestEmail: vi.fn(),
  registered: [] as Array<{ name: string; opts: Record<string, unknown> }>,
}))
vi.mock('@azure/functions', () => ({
  app: { http: (name: string, opts: Record<string, unknown>) => h.registered.push({ name, opts }) },
}))
vi.mock('../shared/admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('../shared/email', () => ({ sendTestEmail: h.sendTestEmail }))

import { __setNow } from './adminTestEmail'

process.env.APP_BASE_URL = 'https://app.example.com'
process.env.ACS_SENDER_ADDRESS = 'rvtrip@moedim.dev'

const ADMIN = { id: 'a', email: 'Admin@x.y', isAdmin: true }
const handler = h.registered[0].opts.handler as (req: never) => Promise<{
  status?: number
  jsonBody?: Record<string, unknown>
  headers?: Record<string, string>
}>

function mkReq(csrf = true) {
  const headers: Record<string, string> = csrf
    ? { origin: 'https://app.example.com', cookie: 'csrf_token=abc', 'x-csrf-token': 'abc' }
    : {}
  return { method: 'POST', headers: { get: (n: string) => headers[n.toLowerCase()] ?? null } } as never
}

let now = 1_000_000
beforeEach(() => {
  h.requireAdmin.mockReset()
  h.sendTestEmail.mockReset()
  h.requireAdmin.mockResolvedValue(ADMIN)
  h.sendTestEmail.mockResolvedValue({ ok: true })
  now = 1_000_000
  __setNow(() => now)
})

describe('registration', () => {
  it('registers POST manage/test-email', () => {
    expect(h.registered).toHaveLength(1)
    expect(h.registered[0].opts.route).toBe('manage/test-email')
    expect(h.registered[0].opts.methods).toEqual(['POST'])
  })
})

describe('guards', () => {
  it.each([
    [401, { status: 401, jsonBody: { error: 'Unauthorized' } }],
    [403, { status: 403, jsonBody: { error: 'Forbidden' } }],
  ])('%s from requireAdmin passes through and nothing is sent', async (status, denial) => {
    h.requireAdmin.mockResolvedValue(denial)
    const res = await handler(mkReq())
    expect(res.status).toBe(status)
    expect(h.sendTestEmail).not.toHaveBeenCalled()
  })

  it('a CSRF failure is rejected 403 before auth or sending', async () => {
    const res = await handler(mkReq(false))
    expect(res.status).toBe(403)
    expect(h.requireAdmin).not.toHaveBeenCalled()
    expect(h.sendTestEmail).not.toHaveBeenCalled()
  })
})

describe('sending', () => {
  it('success returns 200 {sentTo, sender} and sends to the admin address', async () => {
    const res = await handler(mkReq())
    expect(res.status).toBe(200)
    expect(res.jsonBody).toEqual({ sentTo: 'Admin@x.y', sender: 'rvtrip@moedim.dev' })
    expect(h.sendTestEmail).toHaveBeenCalledTimes(1)
    const [to, at] = h.sendTestEmail.mock.calls[0]
    expect(to).toBe('Admin@x.y')
    expect((at as Date).getTime()).toBe(now)
  })

  it('a second call within 60 s gets 429 RATE_LIMITED with Retry-After >= 1 and sends nothing', async () => {
    await handler(mkReq())
    now += 30_000
    const res = await handler(mkReq())
    expect(res.status).toBe(429)
    expect(res.jsonBody).toMatchObject({ code: 'RATE_LIMITED' })
    expect(Number(res.headers?.['Retry-After'])).toBe(30)
    expect(h.sendTestEmail).toHaveBeenCalledTimes(1)
  })

  it('the cooldown is keyed case-insensitively per admin', async () => {
    await handler(mkReq())
    h.requireAdmin.mockResolvedValue({ ...ADMIN, email: 'admin@X.Y' })
    expect((await handler(mkReq())).status).toBe(429)
    h.requireAdmin.mockResolvedValue({ ...ADMIN, email: 'other@x.y' })
    expect((await handler(mkReq())).status).toBe(200)
  })

  it('after 60 s the admin can send again', async () => {
    await handler(mkReq())
    now += 60_000
    expect((await handler(mkReq())).status).toBe(200)
    expect(h.sendTestEmail).toHaveBeenCalledTimes(2)
  })

  it.each([
    [true, 'Email service busy, try again shortly'],
    [false, 'Email could not be sent'],
  ])('ACS failure (retryable=%s) gives 502 EMAIL_FAILED, releases the cooldown and allows an immediate retry', async (retryable, message) => {
    h.sendTestEmail.mockResolvedValueOnce({ ok: false, retryable })
    const res = await handler(mkReq())
    expect(res.status).toBe(502)
    expect(res.jsonBody).toMatchObject({ code: 'EMAIL_FAILED', error: message })
    const retry = await handler(mkReq())
    expect(retry.status).toBe(200)
    expect(h.sendTestEmail).toHaveBeenCalledTimes(2)
  })

  it('a failure after a prior success restores the earlier cooldown', async () => {
    await handler(mkReq())
    now += 60_000
    h.sendTestEmail.mockResolvedValueOnce({ ok: false, retryable: false })
    expect((await handler(mkReq())).status).toBe(502)
    now += 1_000
    // The failed attempt did not start a new window: the original send is 61 s old.
    expect((await handler(mkReq())).status).toBe(200)
  })

  it('a thrown error (missing setting) gives 500 with no secret and releases the cooldown', async () => {
    h.sendTestEmail.mockRejectedValueOnce(new Error('Missing required environment variable: ACS_SENDER_ADDRESS hunter2'))
    const res = await handler(mkReq())
    expect(res.status).toBe(500)
    expect(JSON.stringify(res)).not.toMatch(/hunter2|ACS_SENDER_ADDRESS|Missing required/)
    expect((await handler(mkReq())).status).toBe(200)
  })

  it('two concurrent calls: the second gets 429 while the first is in flight', async () => {
    let finish!: (v: { ok: true }) => void
    h.sendTestEmail.mockReturnValueOnce(new Promise((r) => (finish = r)))
    const first = handler(mkReq())
    await vi.waitFor(() => expect(h.sendTestEmail).toHaveBeenCalledTimes(1))
    const second = await handler(mkReq())
    expect(second.status).toBe(429)
    finish({ ok: true })
    expect((await first).status).toBe(200)
    expect(h.sendTestEmail).toHaveBeenCalledTimes(1)
  })
})
