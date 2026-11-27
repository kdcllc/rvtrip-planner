import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { week: string; price: number; fetched_at: Date }
type Params = Record<string, { value: unknown }>

const h = vi.hoisted(() => ({
  validate: vi.fn(),
  query: vi.fn(),
  key: vi.fn(),
  weekly: vi.fn(),
  latest: vi.fn(),
  registered: [] as Array<{ name: string; opts: Record<string, unknown> }>,
  Unavailable: null as unknown as new () => Error,
}))
vi.mock('mssql', () => ({ default: {} }))
vi.mock('@azure/functions', () => ({
  app: { http: (name: string, opts: Record<string, unknown>) => h.registered.push({ name, opts }) },
}))
vi.mock('../shared/session', () => ({ validateSession: h.validate }))
vi.mock('../shared/config', () => ({ getEiaApiKey: h.key }))
vi.mock('../shared/eia', async () => {
  const actual = await vi.importActual<typeof import('../shared/eia')>('../shared/eia')
  return { ...actual, fetchEiaWeekly: h.weekly, fetchEiaLatest: h.latest }
})
vi.mock('../shared/db', () => {
  class DatabaseUnavailableError extends Error {}
  h.Unavailable = DatabaseUnavailableError
  return {
    query: h.query,
    sql: { NVarChar: () => 'nvarchar', VarChar: () => 'varchar', MAX: 'max' },
    DatabaseUnavailableError,
  }
})
vi.mock('../shared/http', () => ({
  json: (b: unknown, status = 200) => ({ status, jsonBody: b }),
  error: (status: number, error: string) => ({ status, jsonBody: { error } }),
  fromException: (e: unknown) => (e instanceof h.Unavailable ? { status: 503 } : { status: 500 }),
}))

const NOW = new Date('2026-11-26T12:00:00Z')
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000)
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const weeksFrom = (start: string, end: string) => {
  const out: string[] = []
  for (let d = start; d <= end; d = addDays(d, 7)) out.push(d)
  return out
}
const rowsFor = (start: string, end: string, fetchedAt = hoursAgo(1)): Row[] =>
  weeksFrom(start, end).map((week) => ({ week, price: 3.5, fetched_at: fetchedAt }))

let db: Row[]
let upserts: string[]
let handler: (req: never) => Promise<{ status?: number; jsonBody?: Record<string, unknown> }>

const USER = { id: 'u1', email: 'a@b.c' }
const mk = (q: Record<string, string>) => ({ method: 'GET', query: new URLSearchParams(q), headers: { get: () => null } }) as never
const base = { area: 'SCA', product: 'EPMR', from: '2026-01-12', to: '2026-03-02' }
const call = (q: Record<string, string> = {}) => handler(mk({ ...base, ...q }))
const fetches = () => h.weekly.mock.calls.length

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.resetModules()
  for (const m of [h.validate, h.query, h.key, h.weekly, h.latest]) m.mockReset()
  h.registered.length = 0
  db = []
  upserts = []
  h.validate.mockResolvedValue(USER)
  h.key.mockReturnValue('k')
  h.weekly.mockResolvedValue([])
  h.latest.mockResolvedValue(null)
  h.query.mockImplementation(async (text: string, p: Params = {}) => {
    if (/^MERGE/.test(text)) {
      upserts.push(text)
      for (const pt of JSON.parse(p.points.value as string) as Array<{ week: string; price: number }>) {
        db = db.filter((r) => r.week !== pt.week)
        db.push({ week: pt.week, price: pt.price, fetched_at: new Date() })
      }
      db.sort((a, b) => a.week.localeCompare(b.week))
      return { recordset: [] }
    }
    if (/SELECT TOP 1/.test(text)) return { recordset: db.length ? [db[db.length - 1]] : [] }
    const start = p.start.value as string
    const end = p.end.value as string
    return { recordset: db.filter((r) => r.week >= start && r.week <= end) }
  })
  handler = (await import('./fuelPrices')).getFuelPrices as typeof handler
})

afterEach(() => {
  vi.useRealTimers()
})

describe('registration', () => {
  it('registers GET /fuel-prices', () => {
    expect(h.registered).toEqual([
      { name: 'getFuelPrices', opts: expect.objectContaining({ route: 'fuel-prices', methods: ['GET'], authLevel: 'anonymous' }) },
    ])
  })
})

describe('validation', () => {
  it('returns 401 without a session and runs no query', async () => {
    h.validate.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(h.query).not.toHaveBeenCalled()
  })

  it.each([
    ['unknown area', { area: 'XXX' }],
    ['missing area', { area: '' }],
    ['unknown product', { product: 'FOO' }],
    ['missing from', { from: '' }],
    ['malformed to', { to: '2026/03/02' }],
    ['impossible date', { from: '2026-02-30' }],
    ['from after to', { from: '2026-04-01' }],
    ['range over the maximum', { from: '2025-01-01', to: '2026-03-02' }],
  ])('returns 400 for %s', async (_n, q) => {
    expect((await call(q)).status).toBe(400)
    expect(h.query).not.toHaveBeenCalled()
  })

  it('accepts a range of exactly the maximum', async () => {
    expect((await call({ from: '2025-01-26', to: '2026-03-02' })).status).toBe(200)
  })
})

describe('cache and EIA refresh', () => {
  it('serves a covered fresh cache without calling EIA', async () => {
    db = rowsFor('2026-01-05', '2026-03-02')
    const res = await call()
    expect(res.status).toBe(200)
    expect(fetches()).toBe(0)
    const body = res.jsonBody as { points: Array<{ week: string }>; latest: { week: string }; configured: boolean }
    expect(body.configured).toBe(true)
    expect(body.points[0]).toEqual({ week: '2026-01-05', price: 3.5 })
    expect(body.points.length).toBe(9)
    expect(body.latest.week).toBe('2026-03-02')
  })

  it('fetches, upserts and re-reads when nothing is cached', async () => {
    h.weekly.mockResolvedValue([
      { week: '2026-01-05', price: 3.1 },
      { week: '2026-03-02', price: 3.3 },
    ])
    h.latest.mockResolvedValue({ week: '2026-11-23', price: 3.9 })
    const res = await call()
    expect(h.weekly).toHaveBeenCalledWith('k', 'SCA', 'EPMR', '2026-01-05', '2026-03-02')
    expect(h.latest).toHaveBeenCalledWith('k', 'SCA', 'EPMR')
    expect(upserts).toHaveLength(1)
    const body = res.jsonBody as { points: unknown[]; latest: { week: string } }
    expect(body.points).toEqual([
      { week: '2026-01-05', price: 3.1 },
      { week: '2026-03-02', price: 3.3 },
    ])
    expect(body.latest).toEqual({ week: '2026-11-23', price: 3.9 })
  })

  it('upserts with a MERGE under HOLDLOCK that refreshes fetched_at', async () => {
    h.weekly.mockResolvedValue([{ week: '2026-01-05', price: 3.1 }])
    await call()
    expect(upserts[0]).toMatch(/MERGE dbo\.fuel_price_weekly WITH \(HOLDLOCK\)/)
    expect(upserts[0]).toMatch(/WHEN MATCHED THEN UPDATE SET price = s\.price, fetched_at = SYSUTCDATETIME\(\)/)
  })

  it('refetches when the newest row is over 24 hours old and to reaches it', async () => {
    db = rowsFor('2026-01-05', '2026-03-02', hoursAgo(30))
    await call()
    expect(fetches()).toBe(1)
  })

  it('does not refetch a stale cache when the window ends before the newest week', async () => {
    db = rowsFor('2026-01-05', '2026-03-02', hoursAgo(30))
    await call({ to: '2026-02-16' })
    expect(fetches()).toBe(0)
  })

  it('fetches for a partly cached window with a gap', async () => {
    db = [...rowsFor('2026-01-05', '2026-03-02'), ...rowsFor('2026-08-31', '2026-08-31')]
    await call({ from: '2026-01-12', to: '2026-08-31' })
    expect(fetches()).toBe(1)
  })

  it('fetches when the start of the window is not covered by cached rows', async () => {
    db = [...rowsFor('2026-01-05', '2026-03-02'), ...rowsFor('2026-08-31', '2026-08-31')]
    await call({ from: '2026-04-06', to: '2026-08-31' })
    expect(fetches()).toBe(1)
  })

  it('fetches when rows cover Jan-Mar but the newest row is recent and the window runs to Aug', async () => {
    db = [...rowsFor('2026-01-05', '2026-03-02'), ...rowsFor('2026-11-23', '2026-11-23')]
    await call({ from: '2026-01-12', to: '2026-08-31' })
    expect(fetches()).toBe(1)
  })

  it('does not fetch for a future window within 24 hours', async () => {
    db = rowsFor('2026-01-05', '2026-03-02')
    await call({ from: '2026-06-01', to: '2026-06-30' })
    expect(fetches()).toBe(0)
  })

  it('fetches when all cached rows start later than W0 + 6 days and no series start is known', async () => {
    db = rowsFor('2026-03-09', '2026-04-06')
    await call({ from: '2026-01-12', to: '2026-04-06' })
    expect(fetches()).toBe(1)
  })

  it('records a later series start and does not refetch the same window', async () => {
    db = rowsFor('2026-03-09', '2026-04-06')
    h.weekly.mockResolvedValue(weeksFrom('2026-03-02', '2026-04-06').map((week) => ({ week, price: 3.2 })))
    const q = { from: '2026-01-12', to: '2026-04-06' }
    await call(q)
    expect(fetches()).toBe(1)
    const second = await call(q)
    expect(fetches()).toBe(1)
    expect(second.status).toBe(200)
  })
})

describe('without a key or on failure', () => {
  it('returns cached rows with configured false and never fetches when no key is set', async () => {
    h.key.mockReturnValue(null)
    db = rowsFor('2026-01-05', '2026-01-26', hoursAgo(100))
    const res = await call()
    expect(fetches()).toBe(0)
    expect(h.latest).not.toHaveBeenCalled()
    const body = res.jsonBody as { configured: boolean; points: unknown[]; latest: unknown }
    expect(body.configured).toBe(false)
    expect(body.points).toHaveLength(4)
    expect(body.latest).toEqual({ week: '2026-01-26', price: 3.5 })
  })

  it('returns an empty answer without a key and without cache', async () => {
    h.key.mockReturnValue(null)
    const res = await call()
    expect(res.jsonBody).toMatchObject({ configured: false, points: [], latest: null })
  })

  it('returns cached data and logs only the error name when EIA fails', async () => {
    db = rowsFor('2026-01-05', '2026-03-02', hoursAgo(30))
    h.weekly.mockRejectedValue(new Error('request to https://api.eia.gov/?api_key=k failed'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await call()
    expect(res.status).toBe(200)
    expect((res.jsonBody as { points: unknown[] }).points).toHaveLength(9)
    expect(warn).toHaveBeenCalledWith('EIA refresh failed:', 'Error')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('api_key')
    warn.mockRestore()
  })

  it('returns 503 when the database is unavailable', async () => {
    h.query.mockRejectedValue(new h.Unavailable())
    expect((await call()).status).toBe(503)
  })

  it('does not put the API key in the response', async () => {
    db = rowsFor('2026-01-05', '2026-03-02')
    expect(JSON.stringify((await call()).jsonBody)).not.toContain('"k"')
  })
})
