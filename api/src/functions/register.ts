// POST /api/register: invite-code gated registration. Creates the user and a session.
import { createHash, timingSafeEqual } from 'node:crypto'
import { app } from '@azure/functions'
import type { HttpRequest, HttpResponseInit } from '@azure/functions'
import { requireSetting } from '../shared/config'
import { query, sql } from '../shared/db'
import { csrfCookie, csrfGuard, error, fromException, json, sessionCookie, withCookies } from '../shared/http'
import { hash } from '../shared/password'
import { isAdminEmail } from '../shared/admin'
import { buildRegisterWithInviteCodeBatch } from '../shared/inviteCodes'
import { createSession } from '../shared/session'
import type { RegisterResponse } from '../shared/types'

const MIN_PASSWORD_LENGTH = 12
const MAX_PASSWORD_LENGTH = 256
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// SQL Server unique-constraint / unique-index violations.
const DUPLICATE_KEY_NUMBERS = [2627, 2601]

function inviteMatches(provided: unknown): boolean {
  if (typeof provided !== 'string' || provided === '') return false
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(requireSetting('INVITE_CODE')).digest()
  return timingSafeEqual(a, b)
}

function isDuplicateKey(err: unknown): boolean {
  const e = err as { number?: unknown; originalError?: { number?: unknown } } | null
  return DUPLICATE_KEY_NUMBERS.some((n) => e?.number === n || e?.originalError?.number === n)
}

export async function register(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const denied = csrfGuard(req)
    if (denied) return denied

    let body: { email?: unknown; password?: unknown; inviteCode?: unknown }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return error(400, 'Invalid request')
    }
    if (typeof body !== 'object' || body === null) return error(400, 'Invalid request')

    const provided = typeof body.inviteCode === 'string' ? body.inviteCode : ''
    if (provided === '') return error(403, 'Invalid invite code')
    const shared = inviteMatches(provided)

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (email.length > 320 || !EMAIL_PATTERN.test(email)) return error(400, 'Invalid email address')
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      return error(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    }

    const passwordHash = await hash(password)
    let userId: string
    try {
      if (shared) {
        const result = await query<{ id: string }>(
          'INSERT INTO dbo.users (email, password_hash) OUTPUT INSERTED.id VALUES (@email, @passwordHash)',
          {
            email: { type: sql.NVarChar(320), value: email },
            passwordHash: { type: sql.NVarChar(255), value: passwordHash },
          },
        )
        userId = result.recordset[0].id
      } else {
        // Single-use code: consume + create user + mark request registered, atomically.
        const batch = buildRegisterWithInviteCodeBatch(provided, email, passwordHash)
        const result = await query<{ id: string | null }>(batch.text, batch.params)
        const id = result.recordset[0]?.id
        if (!id) return error(403, 'Invalid invite code')
        userId = id
      }
    } catch (err) {
      // Generic, does not confirm whether the address already exists.
      if (isDuplicateKey(err)) return error(400, 'Unable to complete registration')
      throw err
    }

    const session = await createSession(userId)
    const res = json<RegisterResponse>({ user: { id: userId, email, isAdmin: isAdminEmail(email) } }, 201)
    return withCookies(res, sessionCookie(session.token, session.maxAgeSeconds), csrfCookie())
  } catch (err) {
    return fromException(err)
  }
}

app.http('register', {
  route: 'register',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: register,
})
