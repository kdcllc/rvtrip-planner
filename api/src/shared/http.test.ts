import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('mssql', () => ({ default: {} }))

import {
  clearSessionCookie,
  csrfCookie,
  csrfGuard,
  databaseWaking,
  json,
  sessionCookie,
} from './http'

const BASE = 'https://app.example.com'

function withoutOrigin(h: Record<string, string>) {
  const c = { ...h }
  delete c.origin
  return c
}

function req(method: string, headers: Record<string, string> = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return { method, headers: { get: (n: string) => lower[n.toLowerCase()] ?? null } }
}

beforeEach(() => {
  process.env.APP_BASE_URL = BASE
})

describe('cookies', () => {
  it('session cookie is HttpOnly, Secure, SameSite=Lax, Path=/ with Max-Age', () => {
    expect(sessionCookie('tok', 100)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 100,
    })
    expect(clearSessionCookie().maxAge).toBe(0)
  })

  it('csrf cookie is Secure, SameSite=Lax and not HttpOnly', () => {
    const c = csrfCookie()
    expect(c.name).toBe('csrf_token')
    expect(c.secure).toBe(true)
    expect(c.sameSite).toBe('Lax')
    expect(c.httpOnly).toBeFalsy()
  })

  it('csrf issuance needs no incoming token and mints random values (ping path)', () => {
    expect(csrfCookie().value).not.toBe(csrfCookie().value)
  })
})

describe('responses', () => {
  it('databaseWaking is 503 with Retry-After', () => {
    const r = databaseWaking()
    expect(r.status).toBe(503)
    expect((r.headers as Record<string, string>)['Retry-After']).toBeTruthy()
  })
  it('json passes the body through unwrapped', () => {
    expect(json({ ok: true }).jsonBody).toEqual({ ok: true })
  })
})

describe('csrfGuard', () => {
  const good = { origin: BASE, 'x-csrf-token': 'abc', cookie: 'csrf_token=abc' }

  it('does not run on GET', () => {
    expect(csrfGuard(req('GET'))).toBeNull()
  })
  it('allows a matching double-submit with correct origin', () => {
    expect(csrfGuard(req('POST', good))).toBeNull()
  })
  it('rejects a missing header with 403', () => {
    expect(csrfGuard(req('POST', { origin: BASE, cookie: 'csrf_token=abc' }))?.status).toBe(403)
  })
  it('rejects a mismatched header with 403', () => {
    expect(csrfGuard(req('DELETE', { ...good, 'x-csrf-token': 'zzz' }))?.status).toBe(403)
  })
  it('rejects a missing cookie with 403', () => {
    expect(csrfGuard(req('PUT', { origin: BASE, 'x-csrf-token': 'abc' }))?.status).toBe(403)
  })
  it('rejects a foreign origin and missing origin/referer', () => {
    expect(csrfGuard(req('POST', { ...good, origin: 'https://evil.com' }))?.status).toBe(403)
    const noOrigin = withoutOrigin(good)
    expect(csrfGuard(req('POST', noOrigin))?.status).toBe(403)
  })
  it('rejects lookalike origin and referer hosts with 403', () => {
    const evil = `${BASE}.evil.com`
    expect(csrfGuard(req('POST', { ...good, origin: evil }))?.status).toBe(403)
    const noOrigin = withoutOrigin(good)
    expect(csrfGuard(req('POST', { ...noOrigin, referer: `${evil}/x` }))?.status).toBe(403)
  })
  it('falls back to Referer when Origin is absent', () => {
    const noOrigin = withoutOrigin(good)
    expect(csrfGuard(req('POST', { ...noOrigin, referer: `${BASE}/login` }))).toBeNull()
  })
})
