import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const v = vi.hoisted(() => ({ validateSession: vi.fn() }))
vi.mock('./session', () => ({ validateSession: v.validateSession }))
vi.mock('./db', () => ({ DatabaseUnavailableError: class extends Error {} }))

import { isAdminEmail, requireAdmin } from './admin'

const req = { method: 'GET', headers: { get: () => null } }

beforeEach(() => {
  v.validateSession.mockReset()
  process.env.ADMIN_EMAILS = 'Boss@Example.com; other@example.com'
  process.env.APP_BASE_URL = 'https://app.example.com'
})
afterEach(() => {
  delete process.env.ADMIN_EMAILS
})

describe('isAdminEmail', () => {
  it('matches case-insensitively', () => {
    expect(isAdminEmail('BOSS@example.COM')).toBe(true)
    expect(isAdminEmail('other@example.com')).toBe(true)
  })
  it('rejects non-admins and everyone when unset', () => {
    expect(isAdminEmail('x@example.com')).toBe(false)
    delete process.env.ADMIN_EMAILS
    expect(isAdminEmail('boss@example.com')).toBe(false)
  })
})

describe('requireAdmin', () => {
  it('401 without a session', async () => {
    v.validateSession.mockResolvedValue(null)
    expect(await requireAdmin(req)).toMatchObject({ status: 401 })
  })
  it('403 {error:Forbidden} for a non-admin', async () => {
    v.validateSession.mockResolvedValue({ id: 'u', email: 'x@y.z', isAdmin: false })
    expect(await requireAdmin(req)).toMatchObject({ status: 403, jsonBody: { error: 'Forbidden' } })
  })
  it('returns the user for an admin', async () => {
    const user = { id: 'u', email: 'boss@example.com', isAdmin: true }
    v.validateSession.mockResolvedValue(user)
    expect(await requireAdmin(req)).toBe(user)
  })
})
