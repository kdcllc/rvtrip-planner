// Admin diagnostic: POST /api/manage/test-email sends a test email to the signed-in admin.
// Lives under /manage (not /admin) because Static Web Apps 404s /api/admin* (same as adminInviteRequests).
// A per-admin cooldown is kept in memory (per instance); the slot is reserved before sending so
// concurrent requests cannot both send, and released again if the send fails.
import { app } from '@azure/functions'
import type { HttpRequest, HttpResponseInit } from '@azure/functions'
import { requireAdmin } from '../shared/admin'
import { requireSetting } from '../shared/config'
import { sendTestEmail } from '../shared/email'
import { csrfGuard, error, fromException, json } from '../shared/http'
import { TEST_EMAIL_COOLDOWN_SECONDS } from '../shared/types'
import type { ApiUser, TestEmailResponse } from '../shared/types'

const lastSent = new Map<string, number>()

let clock: () => number = Date.now

/** Test seam: override the clock (pass no argument to restore Date.now) and clear cooldown state. */
export function __setNow(fn?: () => number): void {
  clock = fn ?? Date.now
  lastSent.clear()
}

function release(key: string, previous: number | undefined): void {
  if (previous === undefined) lastSent.delete(key)
  else lastSent.set(key, previous)
}

async function sendTest(req: HttpRequest): Promise<HttpResponseInit> {
  let key: string | undefined
  let previous: number | undefined
  try {
    const denied = csrfGuard(req)
    if (denied) return denied
    const result0 = await requireAdmin(req)
    if ('status' in result0) return result0
    const admin = result0 as ApiUser

    key = admin.email.toLowerCase()
    const now = clock()
    previous = lastSent.get(key)
    const windowMs = TEST_EMAIL_COOLDOWN_SECONDS * 1000
    if (previous !== undefined && now - previous < windowMs) {
      const retryAfter = Math.max(1, Math.ceil((windowMs - (now - previous)) / 1000))
      return {
        ...error(429, 'Test email already sent recently', 'RATE_LIMITED'),
        headers: { 'Retry-After': String(retryAfter) },
      }
    }
    lastSent.set(key, now)

    const result = await sendTestEmail(admin.email, new Date(now))
    if (!result.ok) {
      release(key, previous)
      return error(
        502,
        result.retryable ? 'Email service busy, try again shortly' : 'Email could not be sent',
        'EMAIL_FAILED',
      )
    }
    return json<TestEmailResponse>({ sentTo: admin.email, sender: requireSetting('ACS_SENDER_ADDRESS') })
  } catch (err) {
    if (key) release(key, previous)
    return fromException(err)
  }
}

app.http('adminSendTestEmail', {
  route: 'manage/test-email',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: sendTest,
})
