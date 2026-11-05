// Security regression suite: the goal's core promises asserted through the REAL handlers,
// session and http modules against an in-memory fake of the SQL layer. Only the SQL boundary
// (shared/db query), password hashing (speed) and the ACS email sender are replaced.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type User = { id: string; email: string; password_hash: string; failed_attempts: number; locked_until: Date | null }
type Session = { token: string; user_id: string; expires_at: Date }
type ResetToken = { token: string; user_id: string; expires_at: Date; used: boolean }

const h = vi.hoisted(() => ({
  users: new Map<string, unknown>(),
  sessions: new Map<string, unknown>(),
  resets: new Map<string, unknown>(),
  trips: new Map<string, string>(),
  queryFn: vi.fn(),
  sentLinks: [] as string[],
  nextId: 1,
}))
vi.mock('mssql', () => ({ default: {} }))
vi.mock('@azure/functions', () => ({ app: { http: vi.fn() } }))
vi.mock('../shared/db', () => {
  class DatabaseUnavailableError extends Error {
    readonly code = 'DATABASE_UNAVAILABLE'
  }
  return { DatabaseUnavailableError, query: h.queryFn, sql: new Proxy({}, { get: () => () => ({}) }) }
})
vi.mock('../shared/password', () => ({
  hash: async (p: string) => `h:${p}`,
  verify: async (p: string, stored: string) => stored === `h:${p}`,
  verifyAgainstDummy: async () => false,
}))
vi.mock('../shared/email', async () => {
  const actual = await vi.importActual<typeof import('../shared/email')>('../shared/email')
  return {
    ...actual,
    sendPasswordResetEmail: async (_to: string, link: string) => {
      h.sentLinks.push(link)
      return { ok: true }
    },
  }
})

import { forgotPassword } from '../functions/forgotPassword'
import { login } from '../functions/login'
import { logout } from '../functions/logout'
import { me } from '../functions/me'
import { register } from '../functions/register'
import { resetPassword } from '../functions/resetPassword'
import { getTrips, putTrips } from '../functions/trips'

const users = () => h.users as Map<string, User>
const sessions = () => h.sessions as Map<string, Session>
const resets = () => h.resets as Map<string, ResetToken>

const claimAlways = { on: false }

function installFakeDb() {
  h.queryFn.mockImplementation(async (text: string, p: Record<string, { value: unknown }> = {}) => {
    const v = (k: string) => p[k]?.value
    const rs = (rows: unknown[]) => ({ recordset: rows })
    if (/^INSERT INTO dbo\.users/.test(text)) {
      if ([...users().values()].some((u) => u.email === v('email'))) throw Object.assign(new Error('dup'), { number: 2627 })
      const id = `user-${h.nextId++}`
      users().set(id, { id, email: v('email'), password_hash: v('passwordHash'), failed_attempts: 0, locked_until: null })
      return rs([{ id }])
    }
    if (/^INSERT INTO dbo\.sessions/.test(text)) {
      sessions().set(v('token'), { token: v('token'), user_id: v('userId'), expires_at: v('expiresAt') })
      return rs([])
    }
    if (/FROM dbo\.sessions s JOIN dbo\.users/.test(text)) {
      const s = sessions().get(v('token'))
      const u = s && users().get(s.user_id)
      return rs(s && u ? [{ id: u.id, email: u.email, expires_at: s.expires_at }] : [])
    }
    if (/^DELETE FROM dbo\.sessions WHERE user_id = @userId AND expires_at/.test(text)) {
      for (const [t, s] of sessions()) if (s.user_id === v('userId') && s.expires_at <= v('now')) sessions().delete(t)
      return rs([])
    }
    if (/^DELETE FROM dbo\.sessions WHERE token/.test(text)) {
      sessions().delete(v('token'))
      return rs([])
    }
    if (/^DELETE FROM dbo\.sessions WHERE user_id/.test(text)) {
      for (const [t, s] of sessions()) if (s.user_id === v('userId')) sessions().delete(t)
      return rs([])
    }
    if (/^SELECT id, email, password_hash/.test(text)) {
      return rs([...users().values()].filter((u) => u.email === v('email')))
    }
    if (/^SELECT id FROM dbo\.users WHERE email/.test(text)) {
      return rs([...users().values()].filter((u) => u.email === v('email')).map((u) => ({ id: u.id })))
    }
    if (/^UPDATE dbo\.users SET\s+failed_attempts = CASE/.test(text)) {
      const u = users().get(v('id'))!
      const lapsed = u.locked_until !== null && u.locked_until <= v('now')
      const next = lapsed ? 1 : u.failed_attempts + 1
      u.failed_attempts = next
      const reached = />=\s*@max/.test(text) ? next >= v('max') : next > v('max')
      if (reached) u.locked_until = v('lockUntil')
      else if (lapsed) u.locked_until = null
      return rs([])
    }
    if (/^UPDATE dbo\.users SET failed_attempts = 0/.test(text)) {
      const u = users().get(v('id'))!
      u.failed_attempts = 0
      u.locked_until = null
      return rs([])
    }
    if (/^UPDATE dbo\.users SET password_hash/.test(text)) {
      const u = users().get(v('userId'))!
      u.password_hash = v('passwordHash')
      u.failed_attempts = 0
      u.locked_until = null
      return rs([])
    }
    if (/^UPDATE dbo\.password_reset_tokens SET used = 1 WHERE user_id/.test(text)) {
      for (const r of resets().values()) if (r.user_id === v('userId')) r.used = true
      return rs([])
    }
    if (/^INSERT INTO dbo\.password_reset_tokens/.test(text)) {
      resets().set(v('token'), { token: v('token'), user_id: v('userId'), expires_at: v('expiresAt'), used: false })
      return rs([])
    }
    if (/^SELECT user_id, expires_at, used/.test(text)) {
      const r = resets().get(v('token'))
      return rs(r ? [r] : [])
    }
    if (/^UPDATE dbo\.password_reset_tokens SET used = 1\s+OUTPUT/.test(text)) {
      const r = resets().get(v('token'))
      if (!r) return rs([])
      // claimAlways: the DB-side guard is neutralised so only the handler's own check can reject.
      if (!claimAlways.on && (r.used || r.expires_at.getTime() <= v('now').getTime())) return rs([])
      r.used = true
      return rs([{ user_id: r.user_id }])
    }
    if (/^SELECT TOP 1 data FROM dbo\.trips/.test(text)) {
      const d = h.trips.get(v('userId'))
      return rs(d ? [{ data: d }] : [])
    }
    if (/^UPDATE dbo\.trips SET data/.test(text)) {
      h.trips.set(v('userId'), v('data'))
      return rs([])
    }
    throw new Error(`fake db: unhandled statement: ${text.slice(0, 60)}`)
  })
}

const ORIGIN = 'https://app.example.com'

type Cookies = Record<string, string>
/** Folds a handler response's Set-Cookie objects into a cookie jar. */
function absorb(jar: Cookies, res: { cookies?: Array<{ name: string; value: string; maxAge?: number }> }) {
  for (const c of res.cookies ?? []) {
    if (c.maxAge === 0 || c.value === '') delete jar[c.name]
    else jar[c.name] = c.value
  }
}

function mkReq(method: string, jar: Cookies, body?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { origin: ORIGIN, ...extra }
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
  if (cookie) headers.cookie = cookie
  if (jar.csrf_token && headers['x-csrf-token'] === undefined) headers['x-csrf-token'] = jar.csrf_token
  const text = body === undefined ? '' : JSON.stringify(body)
  return {
    method,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    json: async () => JSON.parse(text),
    text: async () => text,
  } as never
}

const tripsBody = {
  trips: [{ id: 't1', name: 'Coast', stops: [{ id: 's1', label: 'Camp' }], createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
  currentTripId: 't1',
}
const CREDS = { email: 'alice@example.com', password: 'correct horse battery' }
const INVITE = 'let-me-in'

const savedEnv = { APP_BASE_URL: process.env.APP_BASE_URL, INVITE_CODE: process.env.INVITE_CODE, SQL_CONNECTION_STRING: process.env.SQL_CONNECTION_STRING }

beforeEach(() => {
  process.env.APP_BASE_URL = ORIGIN
  process.env.INVITE_CODE = INVITE
  for (const m of [h.users, h.sessions, h.resets, h.trips]) m.clear()
  h.sentLinks.length = 0
  h.nextId = 1
  claimAlways.on = false
  h.queryFn.mockReset()
  installFakeDb()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-01T12:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  for (const [k, val] of Object.entries(savedEnv)) {
    if (val === undefined) delete process.env[k]
    else process.env[k] = val
  }
})

async function registerUser(email = CREDS.email, password = CREDS.password): Promise<{ id: string; jar: Cookies }> {
  const jar: Cookies = { csrf_token: 'seed-csrf' }
  const res = await register(mkReq('POST', jar, { email, password, inviteCode: INVITE }))
  expect(res.status).toBe(201)
  absorb(jar, res)
  return { id: (res.jsonBody as { user: { id: string } }).user.id, jar }
}

const anon = (): Cookies => ({ csrf_token: 'seed-csrf' })
const attempt = (email: string, password: string) => login(mkReq('POST', anon(), { email, password }))
const insertCalls = () => h.queryFn.mock.calls.filter((c) => /^INSERT/.test(c[0]))

describe('invite code gate', () => {
  it('a wrong or missing invite code creates no user, no session and runs no INSERT', async () => {
    const wrong = await register(mkReq('POST', anon(), { ...CREDS, inviteCode: 'guess' }))
    const missing = await register(mkReq('POST', anon(), { ...CREDS }))
    const empty = await register(mkReq('POST', anon(), { ...CREDS, inviteCode: '' }))
    for (const res of [wrong, missing, empty]) {
      expect(res.status).toBe(403)
      expect(res.cookies).toBeUndefined()
    }
    expect(users().size).toBe(0)
    expect(sessions().size).toBe(0)
    expect(insertCalls()).toHaveLength(0)
  })

  it('the correct invite code does create the user (control)', async () => {
    await registerUser()
    expect(users().size).toBe(1)
  })
})

describe('login does not enumerate accounts', () => {
  it('unknown email, wrong password and locked account return byte-identical responses', async () => {
    await registerUser()
    const unknown = await attempt('nobody@example.com', 'whatever password')
    const wrong = await attempt(CREDS.email, 'not the password')
    for (let i = 0; i < 5; i += 1) await attempt(CREDS.email, 'not the password')
    const locked = await attempt(CREDS.email, CREDS.password) // correct password, but locked

    expect(unknown.status).toBe(401)
    const serialised = [unknown, wrong, locked].map((r) => JSON.stringify(r))
    expect(serialised[1]).toBe(serialised[0])
    expect(serialised[2]).toBe(serialised[0])
    expect(locked.cookies).toBeUndefined()
  })
})

describe('lockout threshold', () => {
  it('4 consecutive failures do not lock: the correct password still signs in', async () => {
    await registerUser()
    for (let i = 0; i < 4; i += 1) expect((await attempt(CREDS.email, 'bad password')).status).toBe(401)
    expect([...users().values()][0].locked_until).toBeNull()
    expect((await attempt(CREDS.email, CREDS.password)).status).toBe(200)
  })

  it('the 5th consecutive failure locks the account: even the correct password is refused', async () => {
    await registerUser()
    for (let i = 0; i < 5; i += 1) expect((await attempt(CREDS.email, 'bad password')).status).toBe(401)
    expect([...users().values()][0].locked_until).not.toBeNull()
    const res = await attempt(CREDS.email, CREDS.password)
    expect(res.status).toBe(401)
    expect(res.cookies).toBeUndefined()
  })

  it('the lock lapses after 15 minutes', async () => {
    await registerUser()
    for (let i = 0; i < 5; i += 1) await attempt(CREDS.email, 'bad password')
    vi.setSystemTime(new Date('2026-03-01T12:14:00Z'))
    expect((await attempt(CREDS.email, CREDS.password)).status).toBe(401)
    vi.setSystemTime(new Date('2026-03-01T12:15:01Z'))
    expect((await attempt(CREDS.email, CREDS.password)).status).toBe(200)
  })
})

describe('forgot-password does not enumerate accounts', () => {
  it('known and unknown addresses (and junk input) return byte-identical responses', async () => {
    await registerUser()
    const known = await forgotPassword(mkReq('POST', anon(), { email: CREDS.email }))
    expect(h.sentLinks).toHaveLength(1)
    const unknown = await forgotPassword(mkReq('POST', anon(), { email: 'nobody@example.com' }))
    const junk = await forgotPassword(mkReq('POST', anon(), { email: 'not-an-email' }))
    expect(h.sentLinks).toHaveLength(1) // nothing sent for the unknown address
    expect(known.status).toBe(200)
    expect(JSON.stringify(unknown)).toBe(JSON.stringify(known))
    expect(JSON.stringify(junk)).toBe(JSON.stringify(known))
  })
})

describe('reset token lifecycle', () => {
  async function issueToken(): Promise<string> {
    await forgotPassword(mkReq('POST', anon(), { email: CREDS.email }))
    return new URL(h.sentLinks[h.sentLinks.length - 1]).searchParams.get('token')!
  }

  // claimAlways=true removes the DB-side guard, so the handler's own used/expired check is
  // the only thing standing between a replayed or stale token and a password change.
  describe.each([
    ['database claim enforces the rule', false],
    ['handler check alone (claim always returns a row)', true],
  ])('%s', (_label, always) => {
    beforeEach(() => {
      claimAlways.on = always
    })

    it('a reset token cannot be replayed', async () => {
      await registerUser()
      const token = await issueToken()
      const first = await resetPassword(mkReq('POST', anon(), { token, password: 'first new passphrase' }))
      expect(first.status).toBe(200)
      const hashAfterFirst = [...users().values()][0].password_hash

      const replay = await resetPassword(mkReq('POST', anon(), { token, password: 'attacker chosen passphrase' }))
      expect(replay.status).toBe(400)
      expect([...users().values()][0].password_hash).toBe(hashAfterFirst)
      expect((await attempt(CREDS.email, 'attacker chosen passphrase')).status).toBe(401)
    })

    it('a reset token cannot be used after expiry', async () => {
      await registerUser()
      const token = await issueToken()
      const before = [...users().values()][0].password_hash
      vi.setSystemTime(new Date('2026-03-01T13:00:01Z')) // 1h + 1s
      const res = await resetPassword(mkReq('POST', anon(), { token, password: 'too late passphrase' }))
      expect(res.status).toBe(400)
      expect([...users().values()][0].password_hash).toBe(before)
    })

    it('an unknown token is refused with the same body as an expired one', async () => {
      await registerUser()
      const token = await issueToken()
      vi.setSystemTime(new Date('2026-03-01T13:00:01Z'))
      const expired = await resetPassword(mkReq('POST', anon(), { token, password: 'too late passphrase' }))
      const unknown = await resetPassword(mkReq('POST', anon(), { token: 'nope', password: 'too late passphrase' }))
      expect(JSON.stringify(unknown)).toBe(JSON.stringify(expired))
    })
  })

  it('requesting a second token supersedes the first', async () => {
    await registerUser()
    const first = await issueToken()
    const second = await issueToken()
    expect((await resetPassword(mkReq('POST', anon(), { token: first, password: 'first new passphrase' }))).status).toBe(400)
    expect((await resetPassword(mkReq('POST', anon(), { token: second, password: 'second new passphrase' }))).status).toBe(200)
  })
})

describe('trips require a session and trust only it', () => {
  it('GET and PUT /api/trips return 401 with no session cookie or a bogus one', async () => {
    for (const jar of [{ csrf_token: 'seed-csrf' }, { csrf_token: 'seed-csrf', session: 'bogus-token' }] as Cookies[]) {
      expect((await getTrips(mkReq('GET', jar))).status).toBe(401)
      const put = await putTrips(mkReq('PUT', jar, tripsBody))
      expect(put.status).toBe(401)
    }
    expect(h.trips.size).toBe(0)
  })

  it('a caller-supplied user_id in the body is ignored in favour of the session user', async () => {
    const alice = await registerUser()
    const bob = await registerUser('bob@example.com', 'bobs long password')
    const poisoned = {
      ...tripsBody,
      user_id: bob.id,
      userId: bob.id,
      trips: [{ ...tripsBody.trips[0], user_id: bob.id }],
    }
    const res = await putTrips(mkReq('PUT', alice.jar, poisoned))
    expect(res.status).toBe(200)

    expect([...h.trips.keys()]).toEqual([alice.id])
    expect(h.trips.has(bob.id)).toBe(false)
    const stored = JSON.parse(h.trips.get(alice.id)!)
    expect(Object.keys(stored).sort()).toEqual(['currentTripId', 'trips'])
    expect((await getTrips(mkReq('GET', bob.jar))).jsonBody).toEqual({ trips: [], currentTripId: null })
  })
})

describe('CSRF protection on state-changing requests', () => {
  const sessionJar = async () => (await registerUser()).jar

  const cases: Array<[string, (extra: Record<string, string>, jar: Cookies) => Promise<{ status?: number }>]> = [
    ['login', (x, jar) => login(mkReq('POST', jar, CREDS, x))],
    ['register', (x, jar) => register(mkReq('POST', jar, { ...CREDS, inviteCode: INVITE }, x))],
    ['logout', (x, jar) => logout(mkReq('POST', jar, {}, x))],
    ['forgot-password', (x, jar) => forgotPassword(mkReq('POST', jar, { email: CREDS.email }, x))],
    ['reset-password', (x, jar) => resetPassword(mkReq('POST', jar, { token: 't', password: 'long enough password' }, x))],
    ['PUT trips', (x, jar) => putTrips(mkReq('PUT', jar, tripsBody, x))],
  ]

  it.each(cases)('%s: missing X-CSRF-Token header is rejected 403', async (_n, call) => {
    const jar = await sessionJar()
    h.queryFn.mockClear()
    const res = await call({ 'x-csrf-token': '' }, jar)
    expect(res.status).toBe(403)
    expect(h.queryFn).not.toHaveBeenCalled()
  })

  it.each(cases)('%s: mismatched X-CSRF-Token header is rejected 403', async (_n, call) => {
    const jar = await sessionJar()
    h.queryFn.mockClear()
    const res = await call({ 'x-csrf-token': 'something-else' }, jar)
    expect(res.status).toBe(403)
    expect(h.queryFn).not.toHaveBeenCalled()
  })

  it.each(cases)('%s: missing csrf cookie is rejected 403', async (_n, call) => {
    const jar = await sessionJar()
    delete jar.csrf_token
    h.queryFn.mockClear()
    const res = await call({ 'x-csrf-token': 'seed-csrf' }, jar)
    expect(res.status).toBe(403)
    expect(h.queryFn).not.toHaveBeenCalled()
  })

  it('a foreign Origin is rejected 403 even with a matching token pair', async () => {
    const jar = await sessionJar()
    const res = await putTrips(mkReq('PUT', jar, tripsBody, { origin: 'https://evil.example.net' }))
    expect(res.status).toBe(403)
  })

  it('a matching token pair is accepted (control)', async () => {
    const jar = await sessionJar()
    expect((await putTrips(mkReq('PUT', jar, tripsBody))).status).toBe(200)
  })
})

describe('error responses never leak internals', () => {
  const SECRET_CONN = 'Server=tcp:secret-sql.database.windows.net;Password=hunter2-secret'
  const SQL_TEXT = 'SELECT id, email, password_hash FROM dbo.users WHERE email = @email'

  it('every handler maps a raw SQL failure to a generic body without stack, SQL text or connection string', async () => {
    process.env.SQL_CONNECTION_STRING = SECRET_CONN
    const alice = await registerUser()
    const boom = new Error(`Incorrect syntax near ${SQL_TEXT}; ${SECRET_CONN}`)
    h.queryFn.mockReset()
    h.queryFn.mockRejectedValue(boom)

    const calls: Array<[string, () => Promise<{ status?: number }>]> = [
      ['register', () => register(mkReq('POST', anon(), { email: 'new@example.com', password: 'long enough password', inviteCode: INVITE }))],
      ['login', () => login(mkReq('POST', anon(), CREDS))],
      ['logout', () => logout(mkReq('POST', alice.jar, {}))],
      ['me', () => me(mkReq('GET', alice.jar))],
      ['forgotPassword', () => forgotPassword(mkReq('POST', anon(), { email: CREDS.email }))],
      ['resetPassword', () => resetPassword(mkReq('POST', anon(), { token: 'tok', password: 'long enough password' }))],
      ['getTrips', () => getTrips(mkReq('GET', alice.jar))],
      ['putTrips', () => putTrips(mkReq('PUT', alice.jar, tripsBody))],
    ]
    for (const [name, call] of calls) {
      const res = await call()
      const dump = JSON.stringify(res)
      expect(res.status, name).toBe(500)
      expect(dump, name).not.toContain('hunter2')
      expect(dump, name).not.toContain('secret-sql')
      expect(dump, name).not.toContain('Server=')
      expect(dump, name).not.toMatch(/SELECT|dbo\.|password_hash/)
      expect(dump, name).not.toMatch(/\bat .*\(.*:\d+:\d+\)|node_modules|\.ts:\d+/)
      expect(dump, name).not.toContain('Incorrect syntax')
    }
    delete process.env.SQL_CONNECTION_STRING
  })
})
