// Cross-task flow: request invite -> admin lists -> admin sends invite -> register with the
// emailed code -> single-use enforcement -> new user saves a trip with optimistic concurrency.
// REAL handlers, session, http and inviteCodes modules run against an in-memory fake of the SQL
// layer. Only shared/db query, password hashing (speed) and the ACS senders are replaced.
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type User = { id: string; email: string; password_hash: string }
type Session = { token: string; user_id: string; expires_at: Date }
type Req = {
  id: string; email: string; name: string; note: string | null; status: string
  created_at: Date; invited_at: Date | null; invite_count: number; ip_hash: string
}
type Code = { request_id: string; expires_at: Date; used_at: Date | null; revoked: boolean }

const h = vi.hoisted(() => ({
  users: new Map<string, unknown>(),
  sessions: new Map<string, unknown>(),
  trips: new Map<string, { data: string; version: number }>(),
  reqs: new Map<string, unknown>(),
  codes: new Map<string, unknown>(),
  queryFn: vi.fn(),
  invites: [] as Array<{ to: string; name: string; link: string }>,
  notified: [] as Array<{ to: string; email: string }>,
  emailOk: { on: true },
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
    sendInviteRequestNotification: async (to: string, r: { email: string }) => {
      h.notified.push({ to, email: r.email })
      return { ok: true }
    },
    sendInviteEmail: async (to: string, name: string, link: string) => {
      if (!h.emailOk.on) return { ok: false, retryable: false }
      h.invites.push({ to, name, link })
      return { ok: true }
    },
  }
})


import { declineInvite, listInviteRequests, sendInvite } from '../functions/adminInviteRequests'
import { inviteRequests } from '../functions/inviteRequests'
import { register } from '../functions/register'
import { getTrips, putTrip } from '../functions/trips'
import { hashInviteCode } from '../shared/inviteCodes'

const users = () => h.users as Map<string, User>
const sessions = () => h.sessions as Map<string, Session>
const reqs = () => h.reqs as Map<string, Req>
const codes = () => h.codes as Map<string, Code>

function installFakeDb() {
  h.queryFn.mockImplementation(async (text: string, p: Record<string, { value: unknown }> = {}) => {
    const v = (k: string) => p[k]?.value
    const rs = (rows: unknown[]) => ({ recordset: rows })
    if (/^SET XACT_ABORT ON;\s*BEGIN TRAN;\s*DECLARE @req TABLE/.test(text)) {
      const c = codes().get(v('codeHash') as string)
      if (!c || c.used_at !== null || c.revoked || c.expires_at.getTime() <= Date.now()) return rs([{ id: null }])
      if ([...users().values()].some((u) => u.email === v('email'))) throw Object.assign(new Error('dup'), { number: 2627 })
      const id = `user-${h.nextId++}`
      users().set(id, { id, email: v('email') as string, password_hash: v('passwordHash') as string })
      c.used_at = new Date()
      reqs().get(c.request_id)!.status = 'registered'
      return rs([{ id }])
    }
    if (/^SET XACT_ABORT ON;\s*BEGIN TRAN;\s*UPDATE dbo\.invite_codes/.test(text)) {
      for (const c of codes().values()) if (c.request_id === v('requestId') && c.used_at === null) c.revoked = true
      codes().set(v('codeHash') as string, {
        request_id: v('requestId') as string, expires_at: v('expiresAt') as Date, used_at: null, revoked: false,
      })
      return rs([])
    }
    if (/^UPDATE dbo\.invite_codes SET revoked = 1 WHERE code_hash/.test(text)) {
      const c = codes().get(v('codeHash') as string)
      if (c && c.used_at === null) c.revoked = true
      return rs([])
    }
    if (/^UPDATE dbo\.invite_codes SET revoked = 1 WHERE request_id/.test(text)) {
      for (const c of codes().values()) if (c.request_id === v('requestId') && c.used_at === null) c.revoked = true
      return rs([])
    }
    if (/^INSERT INTO dbo\.users/.test(text)) {
      if ([...users().values()].some((u) => u.email === v('email'))) throw Object.assign(new Error('dup'), { number: 2627 })
      const id = `user-${h.nextId++}`
      users().set(id, { id, email: v('email') as string, password_hash: v('passwordHash') as string })
      return rs([{ id }])
    }
    if (/^INSERT INTO dbo\.sessions/.test(text)) {
      sessions().set(v('token') as string, { token: v('token') as string, user_id: v('userId') as string, expires_at: v('expiresAt') as Date })
      return rs([])
    }
    if (/FROM dbo\.sessions s JOIN dbo\.users/.test(text)) {
      const s = sessions().get(v('token') as string)
      const u = s && users().get(s.user_id)
      return rs(s && u ? [{ id: u.id, email: u.email, expires_at: s.expires_at }] : [])
    }
    if (/^DELETE FROM dbo\.sessions/.test(text)) return rs([])
    if (/^SELECT COUNT\(\*\) AS n FROM dbo\.invite_requests/.test(text)) {
      return rs([{ n: [...reqs().values()].filter((r) => r.ip_hash === v('ipHash')).length }])
    }
    if (/^SELECT 1 AS x FROM dbo\.invite_requests WHERE email/.test(text)) {
      return rs([...reqs().values()].filter((r) => r.email === v('email')).map(() => ({ x: 1 })))
    }
    if (/^INSERT INTO dbo\.invite_requests/.test(text)) {
      const id = randomUUID()
      reqs().set(id, {
        id, email: v('email') as string, name: v('name') as string, note: v('note') as string | null, status: 'pending',
        created_at: new Date(), invited_at: null, invite_count: 0, ip_hash: v('ipHash') as string,
      })
      return rs([])
    }
    if (/^SELECT id, email, name, note, status, created_at, invited_at, invite_count FROM dbo\.invite_requests ORDER BY/.test(text)) {
      return rs([...reqs().values()])
    }
    if (/^SELECT id, email, name, note, status, created_at, invited_at, invite_count FROM dbo\.invite_requests WHERE id/.test(text)) {
      const r = reqs().get(v('id') as string)
      return rs(r ? [r] : [])
    }
    if (/^UPDATE dbo\.invite_requests\s+SET status = 'invited'/.test(text)) {
      const r = reqs().get(v('id') as string)
      if (!r) return rs([])
      r.status = 'invited'
      r.invited_at = new Date()
      r.invite_count += 1
      return rs([r])
    }
    if (/^UPDATE dbo\.invite_requests SET status = 'declined'/.test(text)) {
      const r = reqs().get(v('id') as string)
      if (!r || r.status === 'registered') return rs([])
      r.status = 'declined'
      return rs([r])
    }
    const tk = () => `${v('userId')}|${v('tripId')}`
    if (/^SELECT trip_id, data, version FROM dbo\.user_trips/.test(text)) {
      const prefix = `${v('userId')}|`
      return rs([...h.trips].filter(([k]) => k.startsWith(prefix)).map(([k, r]) => ({ trip_id: k.slice(prefix.length), ...r })))
    }
    if (/^SELECT current_trip_id FROM dbo\.users/.test(text)) return rs([{ current_trip_id: null }])
    if (/^SELECT data, version FROM dbo\.user_trips/.test(text)) {
      const r = h.trips.get(tk())
      return rs(r ? [r] : [])
    }
    if (/^INSERT INTO dbo\.user_trips \(user_id, trip_id, data\)\s+VALUES/.test(text)) {
      if (h.trips.has(tk())) throw Object.assign(new Error('duplicate key'), { number: 2627 })
      h.trips.set(tk(), { data: v('data') as string, version: 1 })
      return rs([])
    }
    if (/^UPDATE dbo\.user_trips\s+SET data/.test(text)) {
      const r = h.trips.get(tk())
      if (!r || r.version !== v('baseVersion')) return rs([])
      r.version += 1
      r.data = v('data') as string
      return rs([{ version: r.version }])
    }
    throw new Error(`fake db: unhandled statement: ${text.slice(0, 60)}`)
  })
}

const ORIGIN = 'https://app.example.com'
const ADMIN = 'admin@example.com'

type Cookies = Record<string, string>
function absorb(jar: Cookies, res: { cookies?: Array<{ name: string; value: string; maxAge?: number }> }) {
  for (const c of res.cookies ?? []) {
    if (c.maxAge === 0 || c.value === '') delete jar[c.name]
    else jar[c.name] = c.value
  }
}

function mkReq(method: string, jar: Cookies, body?: unknown, params?: Record<string, string>) {
  const headers: Record<string, string> = { origin: ORIGIN }
  const cookie = Object.entries(jar).map(([k, val]) => `${k}=${val}`).join('; ')
  if (cookie) headers.cookie = cookie
  if (jar.csrf_token) headers['x-csrf-token'] = jar.csrf_token
  const text = body === undefined ? '' : JSON.stringify(body)
  return {
    method,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    json: async () => JSON.parse(text),
    text: async () => text,
    params,
  } as never
}

const anon = (): Cookies => ({ csrf_token: 'seed-csrf' })
const trip = { id: 't1', name: 'Coast', stops: [{ id: 's1', label: 'Camp' }], createdAt: '2026-01-01', updatedAt: '2026-01-01' }
const tripParams = { tripId: 't1' }
const PASSWORD = 'a long enough password'

const envKeys = ['APP_BASE_URL', 'INVITE_CODE', 'ADMIN_EMAILS', 'SESSION_SECRET'] as const
const savedEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]))

beforeEach(() => {
  process.env.APP_BASE_URL = ORIGIN
  process.env.INVITE_CODE = 'shared-fallback-code'
  process.env.ADMIN_EMAILS = ADMIN
  process.env.SESSION_SECRET = 'test-session-secret'
  for (const m of [h.users, h.sessions, h.trips, h.reqs, h.codes]) m.clear()
  h.invites.length = 0
  h.notified.length = 0
  h.emailOk.on = true
  h.nextId = 1
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

async function registerAdmin(): Promise<Cookies> {
  const jar = anon()
  const res = await register(mkReq('POST', jar, { email: ADMIN, password: PASSWORD, inviteCode: 'shared-fallback-code' }))
  expect(res.status).toBe(201)
  expect(res.jsonBody).toMatchObject({ user: { email: ADMIN, isAdmin: true } })
  absorb(jar, res)
  return jar
}

const requestInvite = (email = 'Dana@Example.com', extra: object = {}) =>
  inviteRequests(mkReq('POST', anon(), { email, name: 'Dana', ...extra }))

describe('request invite -> admin invite -> register -> save trip', () => {
  it('walks the whole flow and enforces single use and optimistic concurrency', async () => {
    // 1. Anonymous visitor requests an invite; the admin is notified.
    const asked = await requestInvite()
    expect(asked.status).toBe(200)
    expect(asked.jsonBody).toEqual({ ok: true })
    expect(h.notified).toEqual([{ to: ADMIN, email: 'dana@example.com' }])

    // 2. Admin lists it.
    const admin = await registerAdmin()
    const listed = await listInviteRequests(mkReq('GET', admin))
    expect(listed.status).toBe(200)
    const { requests } = listed.jsonBody as { requests: Array<{ id: string; email: string; status: string; inviteCount: number }> }
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ email: 'dana@example.com', status: 'pending', inviteCount: 0 })

    // 3. Admin sends the invite; capture the link from the (mocked) email.
    const sent = await sendInvite(mkReq('POST', admin, {}, { id: requests[0].id }))
    expect(sent.status).toBe(200)
    expect(sent.jsonBody).toMatchObject({ request: { id: requests[0].id, status: 'invited', inviteCount: 1 } })
    expect(h.invites).toHaveLength(1)
    expect(h.invites[0]).toMatchObject({ to: 'dana@example.com', name: 'Dana' })
    const code = new URL(h.invites[0].link).searchParams.get('invite')!
    expect(code.length).toBeGreaterThanOrEqual(32)
    // Only the hash is stored or sent to the database: the plain code never reaches SQL.
    expect(JSON.stringify(h.queryFn.mock.calls)).not.toContain(code)
    expect([...codes().keys()]).toEqual([hashInviteCode(code)])

    // 4. Register with the code from the link.
    const reg = await register(mkReq('POST', anon(), { email: 'dana@example.com', password: PASSWORD, inviteCode: code }))
    expect(reg.status).toBe(201)
    expect(reg.jsonBody).toMatchObject({ user: { email: 'dana@example.com', isAdmin: false } })
    const dana: Cookies = anon()
    absorb(dana, reg)
    expect(dana.session).toBeTruthy()
    expect(reqs().get(requests[0].id)!.status).toBe('registered')

    // 5. The same code cannot be used again.
    const again = await register(mkReq('POST', anon(), { email: 'eve@example.com', password: PASSWORD, inviteCode: code }))
    expect(again.status).toBe(403)
    expect(again.cookies).toBeUndefined()
    expect([...users().values()].map((u) => u.email).sort()).toEqual([ADMIN, 'dana@example.com'])

    // 6. The new user saves a trip: create, update, stale update -> 409, GET sees the winner.
    const created = await putTrip(mkReq('PUT', dana, { trip, baseVersion: null }, tripParams))
    expect(created.status).toBe(200)
    expect(created.jsonBody).toEqual({ version: 1 })
    const edited = { ...trip, name: 'Coast v2' }
    const updated = await putTrip(mkReq('PUT', dana, { trip: edited, baseVersion: 1 }, tripParams))
    expect(updated.jsonBody).toEqual({ version: 2 })
    const stale = await putTrip(mkReq('PUT', dana, { trip: { ...trip, name: 'Stale' }, baseVersion: 1 }, tripParams))
    expect(stale.status).toBe(409)
    expect(stale.jsonBody).toMatchObject({ code: 'VERSION_CONFLICT', current: { version: 2, trip: { name: 'Coast v2' } } })

    const got = await getTrips(mkReq('GET', dana))
    expect(got.status).toBe(200)
    expect(got.jsonBody).toEqual({ trips: [{ trip: edited, version: 2 }], currentTripId: null })

    // 7. The admin's own account does not see Dana's trip.
    expect((await getTrips(mkReq('GET', admin))).jsonBody).toEqual({ trips: [], currentTripId: null })
  })

  it('resending an invite revokes the earlier code', async () => {
    await requestInvite()
    const admin = await registerAdmin()
    const id = [...reqs().keys()][0]
    await sendInvite(mkReq('POST', admin, {}, { id }))
    const resend = await sendInvite(mkReq('POST', admin, {}, { id }))
    expect(resend.jsonBody).toMatchObject({ request: { status: 'invited', inviteCount: 2 } })
    const [first, second] = h.invites.map((i) => new URL(i.link).searchParams.get('invite')!)
    expect(first).not.toBe(second)
    const old = await register(mkReq('POST', anon(), { email: 'dana@example.com', password: PASSWORD, inviteCode: first }))
    expect(old.status).toBe(403)
    const fresh = await register(mkReq('POST', anon(), { email: 'dana@example.com', password: PASSWORD, inviteCode: second }))
    expect(fresh.status).toBe(201)
  })

  it('an email failure returns 502, revokes the just-issued code and does not mark the request invited', async () => {
    await requestInvite()
    const admin = await registerAdmin()
    const id = [...reqs().keys()][0]
    h.emailOk.on = false
    const res = await sendInvite(mkReq('POST', admin, {}, { id }))
    expect(res.status).toBe(502)
    expect(reqs().get(id)).toMatchObject({ status: 'pending', invite_count: 0 })
    expect([...codes().values()].every((c) => c.revoked)).toBe(true)
  })

  it('declining revokes unused codes so the emailed link stops working', async () => {
    await requestInvite()
    const admin = await registerAdmin()
    const id = [...reqs().keys()][0]
    await sendInvite(mkReq('POST', admin, {}, { id }))
    const code = new URL(h.invites[0].link).searchParams.get('invite')!
    const declined = await declineInvite(mkReq('POST', admin, {}, { id }))
    expect(declined.jsonBody).toMatchObject({ request: { status: 'declined' } })
    const reg = await register(mkReq('POST', anon(), { email: 'dana@example.com', password: PASSWORD, inviteCode: code }))
    expect(reg.status).toBe(403)
  })

  it('a registered request cannot be re-invited or declined (409)', async () => {
    await requestInvite()
    const admin = await registerAdmin()
    const id = [...reqs().keys()][0]
    await sendInvite(mkReq('POST', admin, {}, { id }))
    const code = new URL(h.invites[0].link).searchParams.get('invite')!
    await register(mkReq('POST', anon(), { email: 'dana@example.com', password: PASSWORD, inviteCode: code }))
    expect((await sendInvite(mkReq('POST', admin, {}, { id }))).status).toBe(409)
    expect((await declineInvite(mkReq('POST', admin, {}, { id }))).status).toBe(409)
    expect(h.invites).toHaveLength(1)
  })

  it('unknown and malformed request ids are 404 and 400', async () => {
    const admin = await registerAdmin()
    expect((await sendInvite(mkReq('POST', admin, {}, { id: randomUUID() }))).status).toBe(404)
    expect((await sendInvite(mkReq('POST', admin, {}, { id: 'not-a-uuid' }))).status).toBe(400)
    expect(h.invites).toHaveLength(0)
  })
})
