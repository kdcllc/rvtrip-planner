// GET /api/ping: unauthenticated warm-up. Triggers a paused-database resume with a constant
// SELECT 1 and issues the CSRF cookie. Never waits, sleeps or retries (SWA kills at 45s).
import { app } from '@azure/functions'
import type { HttpRequest, HttpResponseInit } from '@azure/functions'
import { query } from '../shared/db'
import { csrfCookie, fromException, json, withCookies } from '../shared/http'

export async function ping(_req: HttpRequest): Promise<HttpResponseInit> {
  try {
    await query('SELECT 1 AS ok')
    return withCookies(json({ ok: true }), csrfCookie())
  } catch (err) {
    return fromException(err)
  }
}

app.http('ping', {
  route: 'ping',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: ping,
})
