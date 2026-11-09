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
  trips: new Map<string, { data: string; version: number }>(),
  current: new Map<string, string | null>(),
  queryFn: vi.fn(),
  sentLinks: [] as string[],
  reqs: [] as Array<{ email: string; name: string; ipHash: string }>,
  invitesSent: [] as string[],
  notified: [] as string[],
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
    sendInviteEmail: async (to: string) => {
      h.invitesSent.push(to)
      return { ok: true }
    },
    sendInviteRequestNotification: async (to: string) => {
      h.notified.push(to)
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
import { deleteTrip, getTrips, importTrips, putTrip, putTripSelection } from '../functions/trips'
import { declineInvite, listInviteRequests, sendInvite } from '../functions/adminInviteRequests'
import { inviteRequests } from '../functions/inviteRequests'

const users = () => h.users as Map<string, User>
const sessions = () => h.sessions as Map<string, Session>
const resets = () => h.resets as Map<string, ResetToken>

const claimAlways = { on: false }

function installFakeDb() {
  h.queryFn.mockImplementation(async (text: string, p: Record<string, { value: unknown }> = {}) => {
    const v = (k: string) => p[k]?.value
    const rs = (rows: unknown[]) => ({ recordset: rows })
    if (/^SET XACT_ABORT ON;\s*BEGIN TRAN;\s*DECLARE @req TABLE/.test(text)) return rs([{ id: null }])
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
    if (/^SELECT COUNT\(\*\) AS n FROM dbo\.invite_requests/.test(text)) {
      return rs([{ n: h.reqs.filter((r) => r.ipHash === v('ipHash')).length }])
    }
    if (/^SELECT 1 AS x FROM dbo\.invite_requests WHERE email/.test(text)) {
      return rs(h.reqs.filter((r) => r.email === v('email')).map(() => ({ x: 1 })))
    }
    if (/^INSERT INTO dbo\.invite_requests/.test(text)) {
      h.reqs.push({ email: v('email') as string, name: v('name') as string, ipHash: v('ipHash') as string })
      return rs([])
    }
    if (/^SELECT id, email, name, note, status.* FROM dbo\.invite_requests WHERE id/.test(text)) return rs([])
    const tk = () => `${v('userId')}|${v('tripId')}`
    if (/^SELECT trip_id, data, version FROM dbo\.user_trips/.test(text)) {
      const prefix = `${v('userId')}|`
      return rs([...h.trips].filter(([k]) => k.startsWith(prefix)).map(([k, r]) => ({ trip_id: k.slice(prefix.length), ...r })))
    }
    if (/^SELECT current_trip_id FROM dbo\.users/.test(text)) {
      return rs([{ current_trip_id: h.current.get(v('userId')) ?? null }])
    }
    if (/^SELECT data, version FROM dbo\.user_trips/.test(text)) {
      const r = h.trips.get(tk())
      return rs(r ? [r] : [])
    }
    if (/^INSERT INTO dbo\.user_trips \(user_id, trip_id, data\)\s+VALUES/.test(text)) {
      if (h.trips.has(tk())) throw Object.assign(new Error('duplicate key'), { number: 2627 })
      h.trips.set(tk(), { data: v('data') as string, version: 1 })
      return rs([])
    }
    if (/^INSERT INTO dbo\.user_trips \(user_id, trip_id, data\)\s+SELECT/.test(text)) {
      if (h.trips.has(tk())) return { recordset: [], rowsAffected: [0] }
      h.trips.set(tk(), { data: v('data') as string, version: 1 })
      return { recordset: [], rowsAffected: [1] }
    }
    if (/^UPDATE dbo\.user_trips\s+SET data/.test(text)) {
      const r = h.trips.get(tk())
      if (!r || r.version !== v('baseVersion')) return rs([])
      r.version += 1
      r.data = v('data') as string
      return rs([{ version: r.version }])
    }
    if (/^DELETE FROM dbo\.user_trips/.test(text)) {
      h.trips.delete(tk())
      if (h.current.get(v('userId')) === v('tripId')) h.current.set(v('userId'), null)
      return rs([])
    }
    if (/^UPDATE dbo\.users SET current_trip_id = @currentTripId/.test(text)) {
      h.current.set(v('userId'), v('currentTripId') as string | null)
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
  trip: { id: 't1', name: 'Coast', stops: [{ id: 's1', label: 'Camp' }], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  baseVersion: null as number | null,
}
/** Adds the route params the Functions host would provide. */
const withTrip = <T,>(req: T, tripId = 't1') => Object.assign(req as object, { params: { tripId } }) as never
const CREDS = { email: 'alice@example.com', password: 'correct horse battery' }
const INVITE = 'let-me-in'

const savedEnv = {
  APP_BASE_URL: process.env.APP_BASE_URL,
  INVITE_CODE: process.env.INVITE_CODE,
  SQL_CONNECTION_STRING: process.env.SQL_CONNECTION_STRING,
  ADMIN_EMAILS: process.env.ADMIN_EMAILS,
  SESSION_SECRET: process.env.SESSION_SECRET,
}

beforeEach(() => {
  process.env.APP_BASE_URL = ORIGIN
  process.env.INVITE_CODE = INVITE
  delete process.env.ADMIN_EMAILS
  process.env.SESSION_SECRET = 'test-session-secret'
  for (const m of [h.users, h.sessions, h.resets, h.trips, h.current]) m.clear()
  h.reqs.length = 0
  h.invitesSent.length = 0
  h.notified.length = 0
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
  it('every trips endpoint returns 401 with no session cookie or a bogus one', async () => {
    for (const jar of [{ csrf_token: 'seed-csrf' }, { csrf_token: 'seed-csrf', session: 'bogus-token' }] as Cookies[]) {
      expect((await getTrips(mkReq('GET', jar))).status).toBe(401)
      expect((await putTrip(withTrip(mkReq('PUT', jar, tripsBody)))).status).toBe(401)
      expect((await deleteTrip(withTrip(mkReq('DELETE', jar)))).status).toBe(401)
      expect((await importTrips(mkReq('POST', jar, { trips: [tripsBody.trip] }))).status).toBe(401)
      expect((await putTripSelection(mkReq('PUT', jar, { currentTripId: 't1' }))).status).toBe(401)
    }
    expect(h.trips.size).toBe(0)
    expect(h.current.size).toBe(0)
  })

  it('a caller-supplied user_id in the body is ignored in favour of the session user', async () => {
    const alice = await registerUser()
    const bob = await registerUser('bob@example.com', 'bobs long password')
    const poisoned = {
      ...tripsBody,
      user_id: bob.id,
      userId: bob.id,
      trip: { ...tripsBody.trip, user_id: bob.id },
    }
    const res = await putTrip(withTrip(mkReq('PUT', alice.jar, poisoned)))
    expect(res.status).toBe(200)

    expect([...h.trips.keys()]).toEqual([`${alice.id}|t1`])
    const stored = JSON.parse(h.trips.get(`${alice.id}|t1`)!.data)
    expect(Object.keys(stored).sort()).toEqual(['createdAt', 'id', 'name', 'stops', 'updatedAt'])
    expect((await getTrips(mkReq('GET', bob.jar))).jsonBody).toEqual({ trips: [], currentTripId: null })
  })

  it('users cannot read, overwrite, delete or select each other\'s trips', async () => {
    const alice = await registerUser()
    const bob = await registerUser('bob@example.com', 'bobs long password')
    expect((await putTrip(withTrip(mkReq('PUT', alice.jar, tripsBody)))).status).toBe(200)
    // Same trip id for bob is a fresh create, not a conflict with alice's row.
    const bobTrip = { trip: { ...tripsBody.trip, name: 'Bob trip' }, baseVersion: null }
    expect((await putTrip(withTrip(mkReq('PUT', bob.jar, bobTrip)))).status).toBe(200)
    // Bob cannot update alice's row through a version he guessed: his own row is what moves.
    expect((await putTrip(withTrip(mkReq('PUT', bob.jar, { ...bobTrip, baseVersion: 1 })))).jsonBody).toEqual({ version: 2 })
    expect(h.trips.get(`${alice.id}|t1`)!.version).toBe(1)
    expect(JSON.parse(h.trips.get(`${alice.id}|t1`)!.data).name).toBe('Coast')

    expect((await putTripSelection(mkReq('PUT', bob.jar, { currentTripId: 't1' }))).status).toBe(200)
    expect(h.current.has(alice.id)).toBe(false)
    expect((await deleteTrip(withTrip(mkReq('DELETE', bob.jar)))).status).toBe(200)
    expect(h.trips.has(`${alice.id}|t1`)).toBe(true)
    expect(h.trips.has(`${bob.id}|t1`)).toBe(false)

    const mine = (await getTrips(mkReq('GET', alice.jar))).jsonBody as { trips: Array<{ trip: { name: string } }> }
    expect(mine.trips.map((t) => t.trip.name)).toEqual(['Coast'])
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
    ['PUT trip', (x, jar) => putTrip(withTrip(mkReq('PUT', jar, tripsBody, x)))],
    ['DELETE trip', (x, jar) => deleteTrip(withTrip(mkReq('DELETE', jar, undefined, x)))],
    ['import trips', (x, jar) => importTrips(mkReq('POST', jar, { trips: [tripsBody.trip] }, x))],
    ['trip selection', (x, jar) => putTripSelection(mkReq('PUT', jar, { currentTripId: 't1' }, x))],
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
    const res = await putTrip(withTrip(mkReq('PUT', jar, tripsBody, { origin: 'https://evil.example.net' })))
    expect(res.status).toBe(403)
  })

  it('a matching token pair is accepted (control)', async () => {
    const jar = await sessionJar()
    expect((await putTrip(withTrip(mkReq('PUT', jar, tripsBody)))).status).toBe(200)
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
      ['putTrip', () => putTrip(withTrip(mkReq('PUT', alice.jar, tripsBody)))],
      ['deleteTrip', () => deleteTrip(withTrip(mkReq('DELETE', alice.jar)))],
      ['importTrips', () => importTrips(mkReq('POST', alice.jar, { trips: [tripsBody.trip] }))],
      ['putTripSelection', () => putTripSelection(mkReq('PUT', alice.jar, { currentTripId: 't1' }))],
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

describe('admin routes are admin-only', () => {
  const ID = '123e4567-e89b-42d3-a456-426614174000'
  const routes: Array<[string, (jar: Cookies) => Promise<{ status?: number }>]> = [
    ['GET /manage/invite-requests', (jar) => listInviteRequests(Object.assign(mkReq('GET', jar), { params: {} }) as never)],
    ['POST /manage/invite-requests/{id}/invite', (jar) => sendInvite(Object.assign(mkReq('POST', jar, {}), { params: { id: ID } }) as never)],
    ['POST /manage/invite-requests/{id}/decline', (jar) => declineInvite(Object.assign(mkReq('POST', jar, {}), { params: { id: ID } }) as never)],
  ]
  const touchedInvites = () => h.queryFn.mock.calls.some((c) => /invite_requests|invite_codes/.test(c[0]))

  it.each(routes)('%s: anonymous and bogus-session callers get 401 and nothing is read', async (_n, call) => {
    for (const jar of [anon(), { ...anon(), session: 'bogus-token' }]) {
      h.queryFn.mockClear()
      expect((await call(jar)).status).toBe(401)
      expect(touchedInvites()).toBe(false)
    }
    expect(h.invitesSent).toHaveLength(0)
  })

  it.each(routes)('%s: a signed-in non-admin gets 403, no invite data is touched and no email is sent', async (_n, call) => {
    process.env.ADMIN_EMAILS = 'someone-else@example.com'
    const user = await registerUser()
    h.queryFn.mockClear()
    expect((await call(user.jar)).status).toBe(403)
    expect(touchedInvites()).toBe(false)
    expect(h.invitesSent).toHaveLength(0)
  })

  it('an admin is let through (control)', async () => {
    process.env.ADMIN_EMAILS = CREDS.email.toUpperCase()
    const admin = await registerUser()
    h.queryFn.mockClear()
    // Unknown request id: reaches the data layer and answers 404, not 401/403.
    const res = await routes[1][1](admin.jar)
    expect(res.status).toBe(404)
    expect(touchedInvites()).toBe(true)
  })
})

describe('CSRF protection on admin and invite-request routes', () => {
  const ID = '123e4567-e89b-42d3-a456-426614174000'
  const adminCases: Array<[string, (extra: Record<string, string>, jar: Cookies) => Promise<{ status?: number }>]> = [
    ['admin send invite', (x, jar) => sendInvite(Object.assign(mkReq('POST', jar, {}, x), { params: { id: ID } }) as never)],
    ['admin decline', (x, jar) => declineInvite(Object.assign(mkReq('POST', jar, {}, x), { params: { id: ID } }) as never)],
    ['request invite (anonymous)', (x, jar) => inviteRequests(mkReq('POST', jar, { email: 'a@example.com', name: 'A' }, x))],
  ]
  const adminJar = async () => {
    process.env.ADMIN_EMAILS = CREDS.email
    return (await registerUser()).jar
  }

  it.each(adminCases)('%s: missing X-CSRF-Token header is rejected 403 before any work', async (_n, call) => {
    const jar = await adminJar()
    h.queryFn.mockClear()
    expect((await call({ 'x-csrf-token': '' }, jar)).status).toBe(403)
    expect(h.queryFn).not.toHaveBeenCalled()
    expect(h.invitesSent).toHaveLength(0)
  })

  it.each(adminCases)('%s: mismatched X-CSRF-Token header is rejected 403', async (_n, call) => {
    const jar = await adminJar()
    h.queryFn.mockClear()
    expect((await call({ 'x-csrf-token': 'something-else' }, jar)).status).toBe(403)
    expect(h.queryFn).not.toHaveBeenCalled()
  })

  it.each(adminCases)('%s: missing csrf cookie is rejected 403', async (_n, call) => {
    const jar = await adminJar()
    delete jar.csrf_token
    h.queryFn.mockClear()
    expect((await call({ 'x-csrf-token': 'seed-csrf' }, jar)).status).toBe(403)
    expect(h.queryFn).not.toHaveBeenCalled()
  })
})

describe('trips are scoped to the session user in every query', () => {
  it('every user_trips / selection statement carries the caller\'s own id, and a user without a row cannot touch another\'s trip', async () => {
    const alice = await registerUser()
    const bob = await registerUser('bob@example.com', 'bobs long password')
    expect((await putTrip(withTrip(mkReq('PUT', alice.jar, tripsBody)))).status).toBe(200)

    h.queryFn.mockClear()
    // Bob has no t1 row: updating with alice's version must conflict, not modify alice's row.
    const upd = await putTrip(withTrip(mkReq('PUT', bob.jar, { trip: { ...tripsBody.trip, name: 'Hijack' }, baseVersion: 1 })))
    expect(upd.status).toBe(409)
    expect((await getTrips(mkReq('GET', bob.jar))).jsonBody).toEqual({ trips: [], currentTripId: null })
    expect((await deleteTrip(withTrip(mkReq('DELETE', bob.jar)))).status).toBe(200)

    const tripCalls = h.queryFn.mock.calls.filter((c) => /user_trips/.test(c[0]))
    expect(tripCalls.length).toBeGreaterThan(0)
    for (const [, params] of tripCalls) expect(params.userId.value).toBe(bob.id)

    expect(h.trips.get(`${alice.id}|t1`)).toMatchObject({ version: 1 })
    expect(JSON.parse(h.trips.get(`${alice.id}|t1`)!.data).name).toBe('Coast')
  })
})

describe('invite requests do not enumerate or accept bot input', () => {
  const body = { email: 'dana@example.com', name: 'Dana' }
  const insertsOfRequests = () => h.queryFn.mock.calls.filter((c) => /^INSERT INTO dbo\.invite_requests/.test(c[0]))

  it('new and duplicate (even differently cased) addresses get byte-identical responses; only the first stores a row and notifies', async () => {
    process.env.ADMIN_EMAILS = 'admin@example.com'
    const first = await inviteRequests(mkReq('POST', anon(), body))
    const dupe = await inviteRequests(mkReq('POST', anon(), { ...body, email: ' Dana@Example.COM ' }))
    expect(first.status).toBe(200)
    expect(JSON.stringify(dupe)).toBe(JSON.stringify(first))
    expect(h.reqs).toHaveLength(1)
    expect(h.notified).toEqual(['admin@example.com'])
  })

  it('registered users\' addresses answer identically to unknown ones', async () => {
    await registerUser()
    const known = await inviteRequests(mkReq('POST', anon(), { email: CREDS.email, name: 'Alice' }))
    const unknown = await inviteRequests(mkReq('POST', anon(), { email: 'nobody@example.com', name: 'Nobody' }))
    expect(JSON.stringify(known)).toBe(JSON.stringify(unknown))
  })

  it('a filled honeypot stores nothing, sends nothing, and looks like success', async () => {
    process.env.ADMIN_EMAILS = 'admin@example.com'
    const ok = await inviteRequests(mkReq('POST', anon(), body))
    h.reqs.length = 0
    h.notified.length = 0
    h.queryFn.mockClear()
    const bot = await inviteRequests(mkReq('POST', anon(), { email: 'bot@example.com', name: 'Bot', website: 'http://spam.example' }))
    expect(bot.status).toBe(200)
    expect(JSON.stringify(bot)).toBe(JSON.stringify(ok))
    expect(h.reqs).toHaveLength(0)
    expect(insertsOfRequests()).toHaveLength(0)
    expect(h.queryFn).not.toHaveBeenCalled()
    expect(h.notified).toHaveLength(0)
  })

  it('only a salted hash of the client IP is stored, never the address', async () => {
    await inviteRequests(Object.assign(mkReq('POST', anon(), body), {}) as never)
    const req = mkReq('POST', anon(), { email: 'ip@example.com', name: 'Ip' }, { 'x-azure-clientip': '203.0.113.9' })
    await inviteRequests(req)
    expect(h.reqs.every((r) => /^[0-9a-f]{64}$/.test(r.ipHash))).toBe(true)
    expect(JSON.stringify(h.queryFn.mock.calls)).not.toContain('203.0.113.9')
  })
})
