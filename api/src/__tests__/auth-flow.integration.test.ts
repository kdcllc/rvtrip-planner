// Cross-task API flows (tasks 05, 06, 07) run through the REAL handlers, session and http
// modules against an in-memory fake of the SQL layer. Only the SQL boundary (shared/db query),
// password hashing (speed) and the ACS email sender are replaced.
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
  codes: new Map<string, { request_id: string; expires_at: Date; used_at: Date | null; revoked: boolean; user: string | null }>(),
  requestStatus: new Map<string, string>(),
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
import { hashInviteCode } from '../shared/inviteCodes'
import { deleteTrip, getTrips, importTrips, putTrip, putTripSelection } from '../functions/trips'

const users = () => h.users as Map<string, User>
const sessions = () => h.sessions as Map<string, Session>
const resets = () => h.resets as Map<string, ResetToken>

function installFakeDb() {
  h.queryFn.mockImplementation(async (text: string, p: Record<string, { value: unknown }> = {}) => {
    const v = (k: string) => p[k]?.value
    const rs = (rows: unknown[]) => ({ recordset: rows })
    if (/^SET XACT_ABORT ON;\s*BEGIN TRAN;\s*DECLARE @req TABLE/.test(text)) {
      // Atomic consume-and-register: nothing changes unless the whole batch succeeds.
      const c = h.codes.get(v('codeHash') as string)
      if (!c || c.used_at !== null || c.revoked || c.expires_at.getTime() <= Date.now()) return rs([{ id: null }])
      if ([...users().values()].some((u) => u.email === v('email'))) throw Object.assign(new Error('dup'), { number: 2627 })
      const id = `user-${h.nextId++}`
      users().set(id, { id, email: v('email'), password_hash: v('passwordHash'), failed_attempts: 0, locked_until: null })
      c.used_at = new Date()
      c.user = id
      h.requestStatus.set(c.request_id, 'registered')
      return rs([{ id }])
    }
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
      if (next >= v('max')) u.locked_until = v('lockUntil')
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
      if (!r || r.used || r.expires_at.getTime() <= v('now').getTime()) return rs([])
      r.used = true
      return rs([{ user_id: r.user_id }])
    }
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

const savedEnv = { APP_BASE_URL: process.env.APP_BASE_URL, INVITE_CODE: process.env.INVITE_CODE, SQL_CONNECTION_STRING: process.env.SQL_CONNECTION_STRING }

beforeEach(() => {
  process.env.APP_BASE_URL = ORIGIN
  process.env.INVITE_CODE = 'let-me-in'
  for (const m of [h.users, h.sessions, h.resets, h.trips, h.current, h.codes, h.requestStatus]) m.clear()
  h.sentLinks.length = 0
  h.nextId = 1
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

/** Registers the user, returning a fresh jar holding that session. */
async function registerAndLogin(): Promise<Cookies> {
  const anon: Cookies = { csrf_token: 'seed-csrf' }
  const reg = await register(mkReq('POST', anon, { ...CREDS, inviteCode: 'let-me-in' }))
  expect(reg.status).toBe(201)
  const jar: Cookies = { csrf_token: 'seed-csrf' }
  const res = await login(mkReq('POST', jar, CREDS))
  expect(res.status).toBe(200)
  absorb(jar, res)
  return jar
}

describe('register -> login -> trips -> logout', () => {
  it('walks the full sequence and the logged-out session token is rejected afterwards', async () => {
    const jar: Cookies = { csrf_token: 'seed-csrf' }

    const reg = await register(mkReq('POST', jar, { ...CREDS, inviteCode: 'let-me-in' }))
    expect(reg.status).toBe(201)
    absorb(jar, reg)
    expect(jar.session).toBeTruthy()

    // Fresh login replaces the registration session.
    const loginJar: Cookies = { csrf_token: 'seed-csrf' }
    const lg = await login(mkReq('POST', loginJar, CREDS))
    expect(lg.status).toBe(200)
    expect(lg.jsonBody).toMatchObject({ user: { email: CREDS.email, isAdmin: false } })
    absorb(loginJar, lg)
    const token = loginJar.session
    expect(token).toBeTruthy()
    expect(token).not.toBe(jar.session)

    const empty = await getTrips(mkReq('GET', loginJar))
    expect(empty.status).toBe(200)
    expect(empty.jsonBody).toEqual({ trips: [], currentTripId: null })

    const put = await putTrip(withTrip(mkReq('PUT', loginJar, tripsBody)))
    expect(put.status).toBe(200)
    expect(put.jsonBody).toEqual({ version: 1 })
    const sel = await putTripSelection(mkReq('PUT', loginJar, { currentTripId: 't1' }))
    expect(sel.status).toBe(200)
    const after = await getTrips(mkReq('GET', loginJar))
    expect(after.jsonBody).toEqual({ trips: [{ trip: tripsBody.trip, version: 1 }], currentTripId: 't1' })
    const upd = await putTrip(withTrip(mkReq('PUT', loginJar, { trip: tripsBody.trip, baseVersion: 1 })))
    expect(upd.jsonBody).toEqual({ version: 2 })
    const conflicted = await putTrip(withTrip(mkReq('PUT', loginJar, { trip: tripsBody.trip, baseVersion: 1 })))
    expect(conflicted.status).toBe(409)
    expect((await deleteTrip(withTrip(mkReq('DELETE', loginJar)))).status).toBe(200)
    expect((await getTrips(mkReq('GET', loginJar))).jsonBody).toEqual({ trips: [], currentTripId: null })
    expect((await importTrips(mkReq('POST', loginJar, { trips: [tripsBody.trip] }))).jsonBody).toMatchObject({ imported: ['t1'] })

    const out = await logout(mkReq('POST', loginJar, {}))
    expect(out.status).toBe(200)
    expect(sessions().has(token)).toBe(false)

    // The very same (now stale) token, replayed by an attacker.
    const stale: Cookies = { session: token, csrf_token: 'seed-csrf' }
    expect((await getTrips(mkReq('GET', stale))).status).toBe(401)
    expect((await putTrip(withTrip(mkReq('PUT', stale, tripsBody)))).status).toBe(401)
    expect((await me(mkReq('GET', stale))).status).toBe(401)
    // The other (registration) session of the same user is untouched.
    expect((await me(mkReq('GET', jar))).status).toBe(200)
  })

  it('a session past its expiry is rejected', async () => {
    const jar = await registerAndLogin()
    expect((await me(mkReq('GET', jar))).status).toBe(200)
    vi.setSystemTime(new Date('2026-03-09T12:00:00Z')) // > 7 days
    expect((await me(mkReq('GET', jar))).status).toBe(401)
    expect((await getTrips(mkReq('GET', jar))).status).toBe(401)
  })
})

describe('single-use invite codes', () => {
  const mkCode = (over: Partial<{ expires_at: Date; used_at: Date | null; revoked: boolean }> = {}) => {
    h.codes.set(hashInviteCode('single-use'), {
      request_id: 'r1', expires_at: new Date('2026-03-10T00:00:00Z'), used_at: null, revoked: false, user: null, ...over,
    })
  }
  const attempt = (email: string) =>
    register(mkReq('POST', { csrf_token: 'x' }, { email, password: 'a long enough password', inviteCode: 'single-use' }))

  it('works once, marks the request registered, and the reuse is rejected', async () => {
    mkCode()
    const first = await attempt('new@example.com')
    expect(first.status).toBe(201)
    expect(first.jsonBody).toMatchObject({ user: { email: 'new@example.com', isAdmin: false } })
    expect(h.requestStatus.get('r1')).toBe('registered')
    expect((await attempt('other@example.com')).status).toBe(403)
  })

  it.each([
    ['revoked', { revoked: true }],
    ['expired', { expires_at: new Date('2026-02-01T00:00:00Z') }],
  ])('%s code: 403', async (_n, over) => {
    mkCode(over)
    expect((await attempt('new@example.com')).status).toBe(403)
    expect(users().size).toBe(0)
  })

  it('duplicate email does not burn the code', async () => {
    mkCode()
    await register(mkReq('POST', { csrf_token: 'x' }, { ...CREDS, inviteCode: 'let-me-in' }))
    expect((await attempt(CREDS.email)).status).toBe(400)
    expect(h.codes.get(hashInviteCode('single-use'))!.used_at).toBeNull()
    expect((await attempt('fresh@example.com')).status).toBe(201)
  })
})

describe('password reset revokes sessions', () => {
  it('pre-existing session is rejected after reset; new password works, old does not', async () => {
    const jar = await registerAndLogin()
    const oldToken = jar.session
    expect((await getTrips(mkReq('GET', jar))).status).toBe(200)

    const anon: Cookies = { csrf_token: 'x' }
    const forgot = await forgotPassword(mkReq('POST', anon, { email: CREDS.email }))
    expect(forgot.status).toBe(200)
    expect(h.sentLinks).toHaveLength(1)
    const token = new URL(h.sentLinks[0]).searchParams.get('token')!
    expect(token).toBeTruthy()

    // Still valid until the reset is actually performed.
    expect((await me(mkReq('GET', jar))).status).toBe(200)

    const newPassword = 'a brand new passphrase'
    const reset = await resetPassword(mkReq('POST', anon, { token, password: newPassword }))
    expect(reset.status).toBe(200)

    expect(sessions().has(oldToken)).toBe(false)
    expect((await me(mkReq('GET', { session: oldToken }))).status).toBe(401)
    expect((await getTrips(mkReq('GET', { session: oldToken }))).status).toBe(401)

    const oldPw = await login(mkReq('POST', { csrf_token: 'x' }, CREDS))
    expect(oldPw.status).toBe(401)
    const newJar: Cookies = { csrf_token: 'x' }
    const newPw = await login(mkReq('POST', newJar, { email: CREDS.email, password: newPassword }))
    expect(newPw.status).toBe(200)
    absorb(newJar, newPw)
    expect((await me(mkReq('GET', newJar))).status).toBe(200)
  })

  it('does not touch the sessions of other users', async () => {
    const jar = await registerAndLogin()
    const other: Cookies = { csrf_token: 'x' }
    const reg = await register(mkReq('POST', other, { email: 'bob@example.com', password: 'bobs long password', inviteCode: 'let-me-in' }))
    absorb(other, reg)

    await forgotPassword(mkReq('POST', { csrf_token: 'x' }, { email: CREDS.email }))
    const token = new URL(h.sentLinks[0]).searchParams.get('token')!
    await resetPassword(mkReq('POST', { csrf_token: 'x' }, { token, password: 'another long passphrase' }))

    expect((await me(mkReq('GET', jar))).status).toBe(401)
    expect((await me(mkReq('GET', other))).status).toBe(200)
  })
})
