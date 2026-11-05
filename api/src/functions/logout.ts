// POST /api/logout: revokes the session row and clears the cookie. Idempotent.
import { app } from '@azure/functions'
import type { HttpRequest, HttpResponseInit } from '@azure/functions'
import { clearSessionCookie, csrfGuard, fromException, json, readCookie, SESSION_COOKIE, withCookies } from '../shared/http'
import { revokeSession } from '../shared/session'
import type { LogoutResponse } from '../shared/types'

export async function logout(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const denied = csrfGuard(req)
    if (denied) return denied
    const token = readCookie(req, SESSION_COOKIE)
    if (token) await revokeSession(token)
    return withCookies(json<LogoutResponse>({ ok: true }), clearSessionCookie())
  } catch (err) {
    return fromException(err)
  }
}

app.http('logout', {
  route: 'logout',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: logout,
})
