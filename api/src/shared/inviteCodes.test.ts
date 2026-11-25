import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('mssql', () => ({ default: {} }))
vi.mock('./db', () => ({
  query: h.query,
  sql: { NVarChar: () => ({}), Char: () => ({}), UniqueIdentifier: {}, DateTimeOffset: {} },
}))

import {
  buildRegisterWithInviteCodeBatch,
  generateInviteCode,
  hashInviteCode,
  issueInviteCode,
  revokeUnusedInviteCodes,
} from './inviteCodes'

beforeEach(() => {
  h.query.mockReset()
  h.query.mockResolvedValue({ recordset: [] })
})

describe('generateInviteCode / hashInviteCode', () => {
  it('is base64url with at least 128 bits and unique', () => {
    const codes = new Set(Array.from({ length: 200 }, generateInviteCode))
    expect(codes.size).toBe(200)
    for (const c of codes) {
      expect(c).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(c.length).toBeGreaterThanOrEqual(22)
    }
  })

  it('hashes to deterministic 64-char hex SHA-256', () => {
    expect(hashInviteCode('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(hashInviteCode('abc')).toBe(hashInviteCode('abc'))
    expect(hashInviteCode('abd')).not.toBe(hashInviteCode('abc'))
  })
})

describe('issueInviteCode', () => {
  it('revokes previous unused codes, inserts a hash expiring in 14 days, never the plain code', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T00:00:00Z'))
    try {
      const { code, expiresAt } = await issueInviteCode('req-1')
      expect(expiresAt.toISOString()).toBe('2026-03-15T00:00:00.000Z')
      expect(h.query).toHaveBeenCalledTimes(1)
      const [text, params] = h.query.mock.calls[0]
      expect(text).toMatch(/UPDATE dbo\.invite_codes SET revoked = 1 WHERE request_id = @requestId AND used_at IS NULL/)
      expect(text).toContain('INSERT INTO dbo.invite_codes')
      expect(text.indexOf('UPDATE')).toBeLessThan(text.indexOf('INSERT'))
      expect(params.codeHash.value).toBe(hashInviteCode(code))
      expect(params.expiresAt.value).toEqual(expiresAt)
      expect(JSON.stringify(Object.values(params).map((p) => (p as { value: unknown }).value))).not.toContain(code)
    } finally {
      vi.useRealTimers()
    }
  })

  it('two issues yield different codes', async () => {
    const a = await issueInviteCode('r')
    const b = await issueInviteCode('r')
    expect(a.code).not.toBe(b.code)
  })
})

describe('revoke helpers', () => {
  it('revokeUnusedInviteCodes targets unused codes of the request', async () => {
    await revokeUnusedInviteCodes('r1')
    const [text, params] = h.query.mock.calls[0]
    expect(text).toContain('used_at IS NULL')
    expect(params.requestId.value).toBe('r1')
  })
})

describe('buildRegisterWithInviteCodeBatch', () => {
  const b = buildRegisterWithInviteCodeBatch('plain', 'a@b.c', 'pw-hash')

  it('consumes only valid codes (unused, not revoked, not expired) atomically', () => {
    expect(b.text).toContain('SET XACT_ABORT ON')
    expect(b.text).toContain('BEGIN TRAN')
    expect(b.text).toMatch(/used_at IS NULL AND revoked = 0 AND expires_at > SYSUTCDATETIME\(\)/)
    expect(b.text).toContain('IF @@ROWCOUNT = 0')
    expect(b.text).toContain('INSERT INTO dbo.users')
    expect(b.text).toContain("status = 'registered'")
    expect(b.text).toContain('COMMIT')
    expect(b.text).not.toContain('plain')
  })

  it('passes only the code hash as a parameter', () => {
    expect(b.params.codeHash.value).toBe(hashInviteCode('plain'))
    expect(Object.values(b.params).map((p) => p.value)).not.toContain('plain')
  })
})
