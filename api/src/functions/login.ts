// POST /api/login: password login with per-account lockout and non-enumerating errors.
import { app } from '@azure/functions'
import type { HttpRequest, HttpResponseInit } from '@azure/functions'
import { isAdminEmail } from '../shared/admin'
import { query, sql } from '../shared/db'
import { csrfCookie, csrfGuard, error, fromException, json, sessionCookie, withCookies } from '../shared/http'
import { verify, verifyAgainstDummy } from '../shared/password'
import { createSession } from '../shared/session'
import type { LoginResponse } from '../shared/types'

export const MAX_FAILED_ATTEMPTS = 5
export const LOCKOUT_MINUTES = 15

type UserRow = {
  id: string
  email: string
  password_hash: string
  failed_attempts: number
  locked_until: Date | string | null
}

// One response for unknown email, wrong password and locked account.
const invalidCredentials = () => error(401, 'Invalid email or password')

export async function login(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const denied = csrfGuard(req)
    if (denied) return denied

    let body: { email?: unknown; password?: unknown }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return error(400, 'Invalid request')
    }
    if (typeof body !== 'object' || body === null) return error(400, 'Invalid request')
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!email || !password || email.length > 320 || password.length > 256) return invalidCredentials()

    const found = await query<UserRow>(
      'SELECT id, email, password_hash, failed_attempts, locked_until FROM dbo.users WHERE email = @email',
      { email: { type: sql.NVarChar(320), value: email } },
    )
    const user = found.recordset[0]
    if (!user) {
      await verifyAgainstDummy(password) // equalise timing with the real-user path
      return invalidCredentials()
    }

    const now = new Date()
    const locked = user.locked_until !== null && new Date(user.locked_until).getTime() > now.getTime()
    const ok = await verify(password, user.password_hash)
    if (locked) return invalidCredentials()

    if (!ok) {
      // Atomic increment. A lapsed lock restarts the count at 1; the lock is set at the threshold.
      await query(
        `UPDATE dbo.users SET
           failed_attempts = CASE WHEN locked_until IS NOT NULL AND locked_until <= @now THEN 1 ELSE failed_attempts + 1 END,
           locked_until = CASE
             WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= @now THEN 1 ELSE failed_attempts + 1 END) >= @max
               THEN @lockUntil
             WHEN locked_until IS NOT NULL AND locked_until <= @now THEN NULL
             ELSE locked_until END
         WHERE id = @id`,
        {
          id: { type: sql.UniqueIdentifier, value: user.id },
          now: { type: sql.DateTimeOffset, value: now },
          max: { type: sql.Int, value: MAX_FAILED_ATTEMPTS },
          lockUntil: { type: sql.DateTimeOffset, value: new Date(now.getTime() + LOCKOUT_MINUTES * 60000) },
        },
      )
      return invalidCredentials()
    }

    await query('UPDATE dbo.users SET failed_attempts = 0, locked_until = NULL WHERE id = @id', {
      id: { type: sql.UniqueIdentifier, value: user.id },
    })
    const session = await createSession(user.id)
    const res = json<LoginResponse>({ user: { id: user.id, email: user.email, isAdmin: isAdminEmail(user.email) } })
    return withCookies(res, sessionCookie(session.token, session.maxAgeSeconds), csrfCookie())
  } catch (err) {
    return fromException(err)
  }
}

app.http('login', {
  route: 'login',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: login,
})
