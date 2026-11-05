import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  validate: vi.fn(),
  registered: [] as Array<{ name: string; opts: Record<string, unknown> }>,
}))
vi.mock('mssql', () => ({ default: {} }))
vi.mock('@azure/functions', () => ({
  app: { http: (name: string, opts: Record<string, unknown>) => h.registered.push({ name, opts }) },
}))
vi.mock('../shared/session', () => ({ validateSession: h.validate }))

import { DatabaseUnavailableError } from '../shared/db'
import { me } from './me'

const req = { method: 'GET', headers: { get: () => null } } as never

beforeEach(() => {
  h.validate.mockReset()
})

describe('GET /api/me', () => {
  it('registers a GET trigger', () => {
    expect(h.registered[0]).toMatchObject({ name: 'me', opts: { route: 'me', methods: ['GET'] } })
  })

  it('no cookie / expired session: 401 and no user data', async () => {
    h.validate.mockResolvedValue(null)
    const res = await me(req)
    expect(res.status).toBe(401)
    expect(JSON.stringify(res.jsonBody)).not.toMatch(/user|email|id"/)
  })

  it('valid session: id and email only', async () => {
    h.validate.mockResolvedValue({ id: 'u1', email: 'a@b.c', password_hash: 'leak' })
    const res = await me(req)
    expect(res.status).toBe(200)
    expect(res.jsonBody).toEqual({ user: { id: 'u1', email: 'a@b.c' } })
  })

  it('40613: 503', async () => {
    h.validate.mockImplementation(async () => { throw new DatabaseUnavailableError() })
    expect((await me(req)).status).toBe(503)
  })
})
