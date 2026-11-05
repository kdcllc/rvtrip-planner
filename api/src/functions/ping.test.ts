import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  query: vi.fn(),
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
  return { DatabaseUnavailableError, query: h.query }
})

import { DatabaseUnavailableError } from '../shared/db'
import { ping } from './ping'

// No authorization header, no cookies.
const req = { method: 'GET', headers: { get: () => null } } as never

beforeEach(() => {
  h.query.mockReset()
})

describe('GET /api/ping', () => {
  it('registers an anonymous GET trigger at route ping', () => {
    expect(h.registered).toHaveLength(1)
    expect(h.registered[0].name).toBe('ping')
    expect(h.registered[0].opts).toMatchObject({ route: 'ping', methods: ['GET'], authLevel: 'anonymous' })
  })

  it('up: 200, JSON body {ok:true}, CSRF cookie set, no auth needed', async () => {
    h.query.mockResolvedValue({ recordset: [{ ok: 1 }] })
    const res = await ping(req)
    expect(res.status).toBe(200)
    expect(res.jsonBody).toEqual({ ok: true })
    expect(JSON.parse(JSON.stringify(res.jsonBody))).toEqual({ ok: true })
    // The Functions runtime turns jsonBody into a response with Content-Type application/json.
    const real = await vi.importActual<typeof import('@azure/functions')>('@azure/functions')
    const materialised = new real.HttpResponse(res)
    expect(materialised.headers.get('content-type')).toMatch(/^application\/json/)
    expect(JSON.parse(await materialised.text())).toEqual({ ok: true })
    expect(res.body).toBeUndefined()
    const cookies = res.cookies as Array<{ name: string; value: string; httpOnly: boolean }>
    expect(cookies).toHaveLength(1)
    expect(cookies[0].name).toBe('csrf_token')
    expect(cookies[0].value.length).toBeGreaterThan(0)
    expect(cookies[0].httpOnly).toBe(false)
    expect(h.query).toHaveBeenCalledWith('SELECT 1 AS ok')
  })

  it('40613 (DatabaseUnavailableError): 503 with Retry-After, one attempt only', async () => {
    h.query.mockRejectedValue(new DatabaseUnavailableError())
    const res = await ping(req)
    expect(res.status).toBe(503)
    expect((res.headers as Record<string, string>)['Retry-After']).toBeDefined()
    expect(h.query).toHaveBeenCalledTimes(1)
  })

  it('other error: generic error, body does not leak the message', async () => {
    h.query.mockRejectedValue(new Error('secret-server.database.windows.net login failed'))
    const res = await ping(req)
    expect(res.status).toBe(500)
    expect(res.status).not.toBe(200)
    expect(JSON.stringify(res.jsonBody)).not.toMatch(/secret-server|login failed/)
    expect(res.cookies).toBeUndefined()
  })
})
