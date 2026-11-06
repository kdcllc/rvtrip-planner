import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getCurrentUser,
  login,
  logout,
  ping,
  register,
  requestPasswordReset,
  resetPassword,
} from './authClient'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('authClient', () => {
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

  const cases: Array<[string, () => Promise<unknown>, string, string, unknown?]> = [
    ['ping', () => ping(), 'GET', '/api/ping'],
    ['getCurrentUser', () => getCurrentUser(), 'GET', '/api/me'],
    ['logout', () => logout(), 'POST', '/api/logout', {}],
    [
      'register',
      () => register({ email: 'a@b.c', password: 'pw', inviteCode: 'x' }),
      'POST',
      '/api/register',
      { email: 'a@b.c', password: 'pw', inviteCode: 'x' },
    ],
    [
      'login',
      () => login({ email: 'a@b.c', password: 'pw' }),
      'POST',
      '/api/login',
      { email: 'a@b.c', password: 'pw' },
    ],
    [
      'requestPasswordReset',
      () => requestPasswordReset({ email: 'a@b.c' }),
      'POST',
      '/api/forgot-password',
      { email: 'a@b.c' },
    ],
    [
      'resetPassword',
      () => resetPassword({ token: 't', password: 'pw' }),
      'POST',
      '/api/reset-password',
      { token: 't', password: 'pw' },
    ],
  ]

  it.each(cases)('%s uses the right method, path and body', async (_n, call, method, path, body) => {
    fetchMock.mockResolvedValue(json(200, { ok: true }))
    const result = await call()
    expect(result).toMatchObject({ kind: 'success' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(path)
    expect(init.method).toBe(method)
    expect(init.body).toBe(body === undefined ? undefined : JSON.stringify(body))
  })

  it('surfaces login auth failure as a typed result', async () => {
    fetchMock.mockResolvedValue(json(401, { error: 'Invalid credentials' }))
    const result = await login({ email: 'a@b.c', password: 'bad' })
    expect(result).toMatchObject({ kind: 'auth-failure', status: 401 })
  })

  it('defaults isAdmin to false when absent and preserves true', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { user: { id: 'u', email: 'a@b.c' } }))
    const a = await login({ email: 'a@b.c', password: 'pw' })
    expect(a.kind === 'success' && a.data.user.isAdmin).toBe(false)
    fetchMock.mockResolvedValueOnce(json(200, { user: { id: 'u', email: 'a@b.c', isAdmin: true } }))
    const b = await getCurrentUser()
    expect(b.kind === 'success' && b.data.user.isAdmin).toBe(true)
    fetchMock.mockResolvedValueOnce(json(200, { user: { id: 'u', email: 'a@b.c' } }))
    const c = await register({ email: 'a@b.c', password: 'pw', inviteCode: 'x' })
    expect(c.kind === 'success' && c.data.user.isAdmin).toBe(false)
  })
})
