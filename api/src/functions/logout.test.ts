import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  revoke: vi.fn(),
  registered: [] as Array<{ name: string; opts: Record<string, unknown> }>,
}))
vi.mock('mssql', () => ({ default: {} }))
vi.mock('@azure/functions', () => ({
  app: { http: (name: string, opts: Record<string, unknown>) => h.registered.push({ name, opts }) },
}))
vi.mock('../shared/db', () => ({
  DatabaseUnavailableError: class DatabaseUnavailableError extends Error {},
}))
vi.mock('../shared/session', () => ({ revokeSession: h.revoke }))

import { DatabaseUnavailableError } from '../shared/db'
import { logout } from './logout'

process.env.APP_BASE_URL = 'https://app.example.com'

function mkReq(session?: string, csrf = true) {
  const headers: Record<string, string> = {}
  if (csrf) {
    headers.origin = 'https://app.example.com'
    headers['x-csrf-token'] = 'abc'
    headers.cookie = 'csrf_token=abc' + (session ? `; session=${session}` : '')
  }
  return { method: 'POST', headers: { get: (n: string) => headers[n.toLowerCase()] ?? null } } as never
}

beforeEach(() => {
  h.revoke.mockReset()
})

describe('POST /api/logout', () => {
  it('registers a POST trigger', () => {
    expect(h.registered[0]).toMatchObject({ name: 'logout', opts: { route: 'logout', methods: ['POST'] } })
  })

  it('revokes the session row and clears the cookie', async () => {
    h.revoke.mockResolvedValue(undefined)
    const res = await logout(mkReq('tok'))
    expect(h.revoke).toHaveBeenCalledWith('tok')
    expect(res.status).toBe(200)
    expect(res.jsonBody).toEqual({ ok: true })
    const c = (res.cookies as Array<{ name: string; maxAge?: number }>)[0]
    expect(c).toMatchObject({ name: 'session', maxAge: 0 })
  })

  it('is idempotent without a session', async () => {
    const res = await logout(mkReq())
    expect(res.status).toBe(200)
    expect(h.revoke).not.toHaveBeenCalled()
  })

  it('CSRF guard: 403 and nothing revoked', async () => {
    const res = await logout(mkReq('tok', false))
    expect(res.status).toBe(403)
    expect(h.revoke).not.toHaveBeenCalled()
  })

  it('40613: 503', async () => {
    h.revoke.mockImplementation(async () => { throw new DatabaseUnavailableError() })
    expect((await logout(mkReq('tok'))).status).toBe(503)
  })
})
