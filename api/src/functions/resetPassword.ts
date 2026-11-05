// POST /api/reset-password: single-use, short-lived token; revokes all of the user's sessions.
import { app } from '@azure/functions'
import type { HttpRequest, HttpResponseInit } from '@azure/functions'
import { query, sql } from '../shared/db'
import { csrfGuard, error, fromException, json } from '../shared/http'
import { hash } from '../shared/password'
import { revokeAllSessionsForUser } from '../shared/session'

const MIN_PASSWORD_LENGTH = 12 // same rule as register
const MAX_PASSWORD_LENGTH = 256
const INVALID_TOKEN = 'Invalid or expired reset link'

type TokenRow = { user_id: string; expires_at: Date | string; used: boolean | number }

export async function resetPassword(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const denied = csrfGuard(req)
    if (denied) return denied

    let body: { token?: unknown; password?: unknown }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return error(400, 'Invalid request')
    }
    if (typeof body !== 'object' || body === null) return error(400, 'Invalid request')
    const token = typeof body.token === 'string' ? body.token : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (token === '' || token.length > 128) return error(400, INVALID_TOKEN)
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      return error(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    }

    // Lookup by primary key (exact match only).
    const tokenParam = { type: sql.NVarChar(128), value: token }
    const found = await query<TokenRow>(
      'SELECT user_id, expires_at, used FROM dbo.password_reset_tokens WHERE token = @token',
      { token: tokenParam },
    )
    const row = found.recordset[0]
    if (!row || row.used || new Date(row.expires_at).getTime() <= Date.now()) {
      return error(400, INVALID_TOKEN)
    }

    const passwordHash = await hash(password)

    // Atomic single-use claim: only one concurrent request can flip used 0 -> 1.
    const claimed = await query<{ user_id: string }>(
      `UPDATE dbo.password_reset_tokens SET used = 1
         OUTPUT INSERTED.user_id AS user_id
       WHERE token = @token AND used = 0 AND expires_at > @now`,
      { token: tokenParam, now: { type: sql.DateTimeOffset, value: new Date() } },
    )
    const userId = claimed.recordset[0]?.user_id
    if (!userId) return error(400, INVALID_TOKEN)

    await query(
      'UPDATE dbo.users SET password_hash = @passwordHash, failed_attempts = 0, locked_until = NULL WHERE id = @userId',
      {
        passwordHash: { type: sql.NVarChar(255), value: passwordHash },
        userId: { type: sql.UniqueIdentifier, value: userId },
      },
    )
    await revokeAllSessionsForUser(userId)
    return json({ ok: true })
  } catch (err) {
    return fromException(err)
  }
}

app.http('resetPassword', {
  route: 'reset-password',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: resetPassword,
})
