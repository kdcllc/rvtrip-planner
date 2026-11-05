import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiGet, apiPost } from './apiClient'

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

const setCookie = (value: string) => vi.spyOn(document, 'cookie', 'get').mockReturnValue(value)

describe('apiClient', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends same-origin credentials and JSON content type', async () => {
    setCookie('csrf_token=abc')
    fetchMock.mockResolvedValue(json(200, { ok: true }))
    const result = await apiPost('/api/login', { a: 1 })
    expect(result.kind).toBe('success')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/login')
    expect(init.credentials).toBe('same-origin')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('echoes the csrf_token cookie in X-CSRF-Token on state-changing calls', async () => {
    setCookie('other=1; csrf_token=tok123; x=y')
    fetchMock.mockResolvedValue(json(200, { ok: true }))
    await apiPost('/api/logout', {})
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('tok123')
  })

  it('does not send a CSRF header on GET', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true }))
    await apiGet('/api/me')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBeUndefined()
  })

  it('calls ping exactly once, then proceeds, when the csrf cookie is absent', async () => {
    let cookie = ''
    vi.spyOn(document, 'cookie', 'get').mockImplementation(() => cookie)
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/ping') {
        cookie = 'csrf_token=fresh'
        return json(200, { ok: true })
      }
      return json(200, { user: { id: '1', email: 'a@b.c' } })
    })
    const result = await apiPost('/api/login', { email: 'a@b.c' })
    expect(result.kind).toBe('success')
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/ping', '/api/login'])
    const init = fetchMock.mock.calls[1][1] as RequestInit
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('fresh')
  })

  it('never sends a state-changing request without the header', async () => {
    setCookie('')
    fetchMock.mockResolvedValue(json(200, { ok: true }))
    const result = await apiPost('/api/login', {})
    expect(result.kind).toBe('error')
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/ping'])
  })

  it('returns database-waking for 503 with Retry-After after bounded retries', async () => {
    fetchMock.mockImplementation(async () => json(503, { error: 'waking' }, { 'Retry-After': '0' }))
    const result = await apiGet('/api/me', { maxWakeRetries: 2 })
    expect(result).toEqual({ kind: 'database-waking', status: 503, retryAfterSeconds: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('succeeds when a 503 is followed by a 200', async () => {
    fetchMock
      .mockResolvedValueOnce(json(503, { error: 'waking' }, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(json(200, { user: { id: '1', email: 'a@b.c' } }))
    const result = await apiGet('/api/me')
    expect(result.kind).toBe('success')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never retries a 401', async () => {
    fetchMock.mockResolvedValue(json(401, { error: 'nope', code: 'unauthorized' }))
    const result = await apiGet('/api/me')
    expect(result).toEqual({ kind: 'auth-failure', status: 401, error: 'nope', code: 'unauthorized' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never retries a 400 and classifies it as validation failure', async () => {
    setCookie('csrf_token=t')
    fetchMock.mockResolvedValue(json(400, { error: 'bad email' }))
    const result = await apiPost('/api/register', {})
    expect(result.kind).toBe('validation-failure')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps a network failure to a generic error result', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'))
    const result = await apiGet('/api/me')
    expect(result).toEqual({ kind: 'error', status: 0, error: 'Network error' })
  })
})
