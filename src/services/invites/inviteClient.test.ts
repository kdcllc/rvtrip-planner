import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestInvite } from './inviteClient'

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

describe('requestInvite', () => {
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

  const body = { email: 'a@b.co', name: 'Ann', note: 'hi' }

  it('POSTs /api/invite-requests and returns ok', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true }))
    expect(await requestInvite(body)).toEqual({ kind: 'ok' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/invite-requests')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual(body)
  })

  it('maps 429 to rate-limited', async () => {
    fetchMock.mockResolvedValue(json(429, { error: 'slow', code: 'RATE_LIMITED' }))
    expect(await requestInvite(body)).toEqual({ kind: 'rate-limited' })
  })

  it('maps 400 to invalid with the server message', async () => {
    fetchMock.mockResolvedValue(json(400, { error: 'Invalid email' }))
    expect(await requestInvite(body)).toEqual({ kind: 'invalid', message: 'Invalid email' })
  })

  it('maps 503 to database-waking', async () => {
    fetchMock.mockImplementation(async () => json(503, {}, { 'Retry-After': '0' }))
    expect(await requestInvite(body)).toEqual({ kind: 'database-waking' })
  })

  it('maps 500 and network failure to error', async () => {
    fetchMock.mockResolvedValueOnce(json(500, { error: 'boom' }))
    expect(await requestInvite(body)).toEqual({ kind: 'error', message: 'boom' })
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    expect(await requestInvite(body)).toEqual({ kind: 'error', message: 'Network error' })
  })
})
