import { beforeEach, describe, expect, it, vi } from 'vitest'

const q = vi.hoisted(() => vi.fn())
vi.mock('./db', () => ({
  query: q,
  sql: { NVarChar: () => ({}), UniqueIdentifier: {}, DateTimeOffset: {} },
}))

import { createSession, revokeAllSessionsForUser, revokeSession, validateSession } from './session'

const reqWith = (cookie?: string) => ({
  method: 'GET',
  headers: { get: (n: string) => (n.toLowerCase() === 'cookie' ? (cookie ?? null) : null) },
})

beforeEach(() => {
  q.mockReset()
  q.mockResolvedValue({ recordset: [] })
})

describe('createSession', () => {
  it('inserts a random >=32-byte base64url token with a future expiry', async () => {
    const a = await createSession('u1')
    const b = await createSession('u1')
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43,}$/)
    expect(a.token).not.toBe(b.token)
    expect(a.expiresAt.getTime()).toBeGreaterThan(Date.now())
    const [text, params] = q.mock.calls[0]
    expect(text).toContain('INSERT INTO dbo.sessions')
    expect(params.token.value).toBe(a.token)
    expect(params.expiresAt.value).toEqual(a.expiresAt)
  })
})

describe('validateSession', () => {
  it('returns null without a cookie and does not query', async () => {
    expect(await validateSession(reqWith())).toBeNull()
    expect(q).not.toHaveBeenCalled()
  })
  it('returns null for an unknown token', async () => {
    expect(await validateSession(reqWith('session=nope'))).toBeNull()
  })
  it('returns the user for a live session and purges expired rows for that user', async () => {
    q.mockResolvedValueOnce({
      recordset: [{ id: 'u1', email: 'a@b.c', expires_at: new Date(Date.now() + 60000) }],
    })
    expect(await validateSession(reqWith('x=1; session=tok'))).toEqual({ id: 'u1', email: 'a@b.c' })
    expect(q.mock.calls[1][0]).toContain('DELETE FROM dbo.sessions')
    expect(q.mock.calls[1][0]).toContain('expires_at <=')
  })
  it('rejects an expired session', async () => {
    q.mockResolvedValueOnce({
      recordset: [{ id: 'u1', email: 'a@b.c', expires_at: new Date(Date.now() - 1000) }],
    })
    expect(await validateSession(reqWith('session=old'))).toBeNull()
  })
})

describe('revocation', () => {
  it('revokeSession deletes by token', async () => {
    await revokeSession('tok')
    expect(q.mock.calls[0][0]).toContain('WHERE token = @token')
    expect(q.mock.calls[0][1].token.value).toBe('tok')
  })
  it('revokeAllSessionsForUser deletes by user', async () => {
    await revokeAllSessionsForUser('u1')
    expect(q.mock.calls[0][0]).toContain('WHERE user_id = @userId')
    expect(q.mock.calls[0][1].userId.value).toBe('u1')
  })
})
