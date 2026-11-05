// Session create/validate/revoke against dbo.sessions (see db/migrations/001-initial.sql).
import { randomBytes } from 'node:crypto'
import { query, sql } from './db'
import { readCookie, SESSION_COOKIE, type RequestLike } from './http'
import type { ApiUser } from './types'

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

export type CreatedSession = { token: string; expiresAt: Date; maxAgeSeconds: number }

/** Inserts a session with a random opaque token (32 bytes, base64url) and explicit expiry. */
export async function createSession(userId: string): Promise<CreatedSession> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000)
  await query(
    'INSERT INTO dbo.sessions (token, user_id, expires_at) VALUES (@token, @userId, @expiresAt)',
    {
      token: { type: sql.NVarChar(128), value: token },
      userId: { type: sql.UniqueIdentifier, value: userId },
      expiresAt: { type: sql.DateTimeOffset, value: expiresAt },
    },
  )
  return { token, expiresAt, maxAgeSeconds: SESSION_TTL_SECONDS }
}

type SessionRow = { id: string; email: string; expires_at: Date | string }

/**
 * Returns the session's user, or null when the cookie is absent, unknown or expired.
 *
 * Cleanup lives here because managed Functions have NO timer trigger to purge expired rows.
 * So every lookup opportunistically deletes expired rows for the same user.
 */
export async function validateSession(request: RequestLike): Promise<ApiUser | null> {
  const token = readCookie(request, SESSION_COOKIE)
  if (!token) return null
  const result = await query<SessionRow>(
    `SELECT u.id AS id, u.email AS email, s.expires_at AS expires_at
       FROM dbo.sessions s JOIN dbo.users u ON u.id = s.user_id
      WHERE s.token = @token`,
    { token: { type: sql.NVarChar(128), value: token } },
  )
  const row = result.recordset[0]
  if (!row) return null
  await purgeExpiredForUser(row.id)
  if (new Date(row.expires_at).getTime() <= Date.now()) return null
  return { id: row.id, email: row.email }
}

async function purgeExpiredForUser(userId: string): Promise<void> {
  await query('DELETE FROM dbo.sessions WHERE user_id = @userId AND expires_at <= @now', {
    userId: { type: sql.UniqueIdentifier, value: userId },
    now: { type: sql.DateTimeOffset, value: new Date() },
  })
}

export async function revokeSession(token: string): Promise<void> {
  await query('DELETE FROM dbo.sessions WHERE token = @token', {
    token: { type: sql.NVarChar(128), value: token },
  })
}

/** Required by password reset: invalidates every session of the user. */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await query('DELETE FROM dbo.sessions WHERE user_id = @userId', {
    userId: { type: sql.UniqueIdentifier, value: userId },
  })
}
