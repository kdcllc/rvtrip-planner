// POST /api/invite-requests: anonymous access request from the landing page.
// Spam-protected (honeypot + per-IP-hash rate limit); admins are emailed on new requests.
// Only a salted SHA-256 of the client IP is stored; the clear IP is never persisted or logged.
import { createHash } from 'node:crypto'
import { app } from '@azure/functions'
import type { HttpRequest, HttpResponseInit } from '@azure/functions'
import { getAdminEmails, requireSetting } from '../shared/config'
import { query, sql } from '../shared/db'
import { sendInviteRequestNotification } from '../shared/email'
import { csrfGuard, error, fromException, json } from '../shared/http'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_EMAIL_LENGTH = 320
const MAX_NAME_LENGTH = 200
const MAX_NOTE_LENGTH = 1000
const RATE_LIMIT_MAX = 5
const DUPLICATE_KEY_NUMBERS = [2627, 2601]

function isDuplicateKey(err: unknown): boolean {
  const e = err as { number?: unknown; originalError?: { number?: unknown } } | null
  return DUPLICATE_KEY_NUMBERS.some((n) => e?.number === n || e?.originalError?.number === n)
}

function clientIp(req: HttpRequest): string {
  const azure = req.headers.get('x-azure-clientip')?.trim()
  if (azure) return azure
  const first = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return first || 'unknown'
}

function hashIp(ip: string): string {
  return createHash('sha256').update(ip + requireSetting('SESSION_SECRET')).digest('hex')
}

export async function inviteRequests(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const denied = csrfGuard(req)
    if (denied) return denied

    let body: { email?: unknown; name?: unknown; note?: unknown; website?: unknown }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return error(400, 'Invalid request')
    }
    if (typeof body !== 'object' || body === null) return error(400, 'Invalid request')

    // Honeypot: bots fill the hidden field. Pretend success, store and send nothing.
    if (typeof body.website === 'string' && body.website !== '') return json({ ok: true })

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') {
      return error(400, 'Invalid note')
    }
    const note = typeof body.note === 'string' ? body.note.trim() : ''
    if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) return error(400, 'Invalid email address')
    if (name.length < 1 || name.length > MAX_NAME_LENGTH) return error(400, 'Invalid name')
    if (note.length > MAX_NOTE_LENGTH) return error(400, 'Note is too long')

    const ipHash = hashIp(clientIp(req))
    const recent = await query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM dbo.invite_requests
        WHERE ip_hash = @ipHash AND created_at > DATEADD(hour, -1, SYSUTCDATETIME())`,
      { ipHash: { type: sql.Char(64), value: ipHash } },
    )
    if ((recent.recordset[0]?.n ?? 0) >= RATE_LIMIT_MAX) {
      return error(429, 'Too many requests, please try again later', 'RATE_LIMITED')
    }

    // Duplicate (any status): same response as success, no new row, no email.
    const existing = await query('SELECT 1 AS x FROM dbo.invite_requests WHERE email = @email', {
      email: { type: sql.NVarChar(320), value: email },
    })
    if (existing.recordset.length > 0) return json({ ok: true })

    try {
      await query(
        `INSERT INTO dbo.invite_requests (email, name, note, status, ip_hash)
         VALUES (@email, @name, @note, 'pending', @ipHash)`,
        {
          email: { type: sql.NVarChar(320), value: email },
          name: { type: sql.NVarChar(200), value: name },
          note: { type: sql.NVarChar(1000), value: note === '' ? null : note },
          ipHash: { type: sql.Char(64), value: ipHash },
        },
      )
    } catch (err) {
      if (isDuplicateKey(err)) return json({ ok: true })
      throw err
    }

    for (const admin of getAdminEmails()) {
      try {
        const result = await sendInviteRequestNotification(admin, { name, email, note: note === '' ? null : note })
        if (!result.ok) console.error('invite request notification failed', { retryable: result.retryable })
      } catch {
        console.error('invite request notification failed')
      }
    }
    return json({ ok: true })
  } catch (err) {
    return fromException(err)
  }
}

app.http('inviteRequests', {
  route: 'invite-requests',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: inviteRequests,
})
