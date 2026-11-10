import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInvite, declineInvite, listInviteRequests, sendInvite, sendTestEmail } from './adminClient'

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

const req = {
  id: 'r1',
  email: 'a@b.co',
  name: 'Ann',
  note: null,
  status: 'invited',
  createdAt: '2024-01-01T00:00:00Z',
  invitedAt: null,
  inviteCount: 1,
}

describe('adminClient', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('csrf_token=t')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('listInviteRequests GETs and returns requests', async () => {
    fetchMock.mockResolvedValue(json(200, { requests: [req] }))
    expect(await listInviteRequests()).toEqual({ kind: 'ok', requests: [req] })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/manage/invite-requests')
    expect(init.method).toBe('GET')
  })

  it('listInviteRequests maps failures', async () => {
    fetchMock.mockResolvedValueOnce(json(403, { error: 'no' }))
    expect(await listInviteRequests()).toEqual({ kind: 'forbidden' })
    fetchMock.mockResolvedValueOnce(json(401, { error: 'no' }))
    expect(await listInviteRequests()).toEqual({ kind: 'session-expired' })
    fetchMock.mockImplementation(async () => json(503, {}, { 'Retry-After': '0' }))
    expect(await listInviteRequests()).toEqual({ kind: 'database-waking' })
    fetchMock.mockResolvedValueOnce(json(500, { error: 'boom' }))
    expect(await listInviteRequests()).toEqual({
      kind: 'error',
      message: 'boom',
    })
    fetchMock.mockResolvedValueOnce(json(200, {}))
    expect(await listInviteRequests()).toEqual({
      kind: 'error',
      message: 'Invalid response',
    })
  })

  const sentBody = {
    request: req,
    inviteLink: 'https://x/#code',
    emailSent: true,
  }

  it('sendInvite POSTs /invite and returns link + emailSent', async () => {
    fetchMock.mockResolvedValue(json(200, sentBody))
    expect(await sendInvite('r 1')).toEqual({ kind: 'sent', ...sentBody })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/manage/invite-requests/r%201/invite')
    expect(init.method).toBe('POST')
  })

  it('createInvite POSTs /api/manage/invites with email and name only', async () => {
    fetchMock.mockResolvedValue(json(200, { ...sentBody, emailSent: false }))
    expect(await createInvite({ email: 'a@b.co', name: 'Ann' })).toEqual({
      kind: 'sent',
      ...sentBody,
      emailSent: false,
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/manage/invites')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'a@b.co',
      name: 'Ann',
    })
  })

  it('createInvite omits name when undefined', async () => {
    fetchMock.mockResolvedValue(json(200, sentBody))
    await createInvite({ email: 'a@b.co' })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.co' })
  })

  it('maps invalid success bodies to Invalid response', async () => {
    const bad = [
      { request: req, emailSent: true },
      { request: req, inviteLink: 'l' },
      { inviteLink: 'l', emailSent: true },
    ]
    for (const body of bad) {
      fetchMock.mockResolvedValueOnce(json(200, body))
      expect(await sendInvite('r1')).toEqual({
        kind: 'error',
        message: 'Invalid response',
      })
      fetchMock.mockResolvedValueOnce(json(200, body))
      expect(await createInvite({ email: 'a@b.co' })).toEqual({
        kind: 'error',
        message: 'Invalid response',
      })
    }
  })

  it('declineInvite POSTs /decline', async () => {
    fetchMock.mockResolvedValue(json(200, { request: { ...req, status: 'declined' } }))
    const r = await declineInvite('r1')
    expect(r.kind === 'ok' && r.request.status).toBe('declined')
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('/api/manage/invite-requests/r1/decline')
  })

  it('maps failures for sendInvite, createInvite and declineInvite', async () => {
    fetchMock.mockResolvedValueOnce(json(502, { error: 'mail', code: 'EMAIL_FAILED' }))
    expect(await sendInvite('r1')).toEqual({ kind: 'error', message: 'mail' })
    fetchMock.mockResolvedValueOnce(json(409, { error: 'registered' }))
    expect(await sendInvite('r1')).toEqual({
      kind: 'conflict',
      message: 'registered',
    })
    fetchMock.mockResolvedValueOnce(json(409, { error: 'registered' }))
    expect(await createInvite({ email: 'a@b.co' })).toEqual({
      kind: 'conflict',
      message: 'registered',
    })
    fetchMock.mockResolvedValueOnce(json(400, { error: 'bad email' }))
    expect(await createInvite({ email: 'x' })).toEqual({
      kind: 'error',
      message: 'bad email',
    })
    fetchMock.mockResolvedValueOnce(json(403, { error: 'no' }))
    expect(await createInvite({ email: 'a@b.co' })).toEqual({
      kind: 'forbidden',
    })
    fetchMock.mockResolvedValueOnce(json(401, { error: 'no' }))
    expect(await createInvite({ email: 'a@b.co' })).toEqual({
      kind: 'session-expired',
    })
    fetchMock.mockResolvedValueOnce(json(403, { error: 'no' }))
    expect(await declineInvite('r1')).toEqual({ kind: 'forbidden' })
    fetchMock.mockResolvedValueOnce(json(401, { error: 'no' }))
    expect(await declineInvite('r1')).toEqual({ kind: 'session-expired' })
    fetchMock.mockImplementation(async () => json(503, {}, { 'Retry-After': '0' }))
    expect(await declineInvite('r1')).toEqual({ kind: 'database-waking' })
    expect(await createInvite({ email: 'a@b.co' })).toEqual({
      kind: 'database-waking',
    })
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(json(500, { error: 'boom' }))
    expect(await declineInvite('r1')).toEqual({
      kind: 'error',
      message: 'boom',
    })
  })

  describe('sendTestEmail', () => {
    it('POSTs to the test-email route and maps success to sent', async () => {
      fetchMock.mockResolvedValue(json(200, { sentTo: 'a@b.co', sender: 'rvtrip@moedim.dev' }))
      expect(await sendTestEmail()).toEqual({ kind: 'sent', sentTo: 'a@b.co', sender: 'rvtrip@moedim.dev' })
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/manage/test-email')
      expect(init.method).toBe('POST')
    })

    it('maps a malformed success body to error', async () => {
      fetchMock.mockResolvedValue(json(200, { sentTo: 5 }))
      expect(await sendTestEmail()).toEqual({ kind: 'error', message: 'Invalid response' })
    })

    it('maps 429 to rate-limited with a 60 second wait', async () => {
      fetchMock.mockResolvedValue(json(429, { error: 'slow down', code: 'RATE_LIMITED' }, { 'Retry-After': '30' }))
      expect(await sendTestEmail()).toEqual({ kind: 'rate-limited', retryAfterSeconds: 60 })
    })

    it('maps EMAIL_FAILED to email-failed with the server message', async () => {
      fetchMock.mockResolvedValue(json(502, { error: 'Email could not be sent', code: 'EMAIL_FAILED' }))
      expect(await sendTestEmail()).toEqual({ kind: 'email-failed', message: 'Email could not be sent' })
    })

    it('maps 403 to forbidden and 401 to session-expired', async () => {
      fetchMock.mockResolvedValueOnce(json(403, { error: 'no' }))
      expect(await sendTestEmail()).toEqual({ kind: 'forbidden' })
      fetchMock.mockResolvedValueOnce(json(401, { error: 'no' }))
      expect(await sendTestEmail()).toEqual({ kind: 'session-expired' })
    })

    it('maps other failures to error', async () => {
      fetchMock.mockResolvedValueOnce(json(500, { error: 'boom' }))
      expect(await sendTestEmail()).toEqual({ kind: 'error', message: 'boom' })
    })
  })
})
