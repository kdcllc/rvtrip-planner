// POST /api/forgot-password: always 200 with an identical body (no account enumeration).
import { randomBytes } from 'node:crypto'
import { app } from '@azure/functions'
import type { HttpRequest, HttpResponseInit } from '@azure/functions'
import { query, sql } from '../shared/db'
import { buildResetLink, sendPasswordResetEmail } from '../shared/email'
import { csrfGuard, fromException, json } from '../shared/http'

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const RESPONSE_BODY = { ok: true }

export async function forgotPassword(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const denied = csrfGuard(req)
    if (denied) return denied

    let email = ''
    try {
      const body = (await req.json()) as { email?: unknown } | null
      if (typeof body?.email === 'string') email = body.email.trim().toLowerCase()
    } catch {
      // Malformed body: same response as everything else.
    }
    if (email.length === 0 || email.length > 320 || !EMAIL_PATTERN.test(email)) return json(RESPONSE_BODY)

    const found = await query<{ id: string }>('SELECT id FROM dbo.users WHERE email = @email', {
      email: { type: sql.NVarChar(320), value: email },
    })
    const user = found.recordset[0]
    if (!user) return json(RESPONSE_BODY)

    const userId = { type: sql.UniqueIdentifier, value: user.id }
    // Supersede any outstanding unused token for this user.
    await query('UPDATE dbo.password_reset_tokens SET used = 1 WHERE user_id = @userId AND used = 0', {
      userId,
    })
    const token = randomBytes(32).toString('base64url')
    await query(
      'INSERT INTO dbo.password_reset_tokens (token, user_id, expires_at, used) VALUES (@token, @userId, @expiresAt, 0)',
      {
        token: { type: sql.NVarChar(128), value: token },
        userId,
        expiresAt: { type: sql.DateTimeOffset, value: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
      },
    )
    // Link-build and send failures (missing APP_BASE_URL, ACS 429, ...) never change what the caller sees.
    try {
      await sendPasswordResetEmail(email, buildResetLink(token))
    } catch {
      // Swallowed deliberately: identical 200 as for an unknown email.
    }
    return json(RESPONSE_BODY)
  } catch (err) {
    return fromException(err)
  }
}

app.http('forgotPassword', {
  route: 'forgot-password',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: forgotPassword,
})
