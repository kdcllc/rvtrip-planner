// Weekly fuel prices over dbo.fuel_price_weekly, filled from the EIA API v2 when EIA_API_KEY is set.
//   GET /api/fuel-prices?area=&product=&from=&to=   weekly rows for [from - 7 days, to]
// The key is never logged or returned; EIA failures are logged by error name only and the
// cached rows are returned instead.
import { app } from '@azure/functions'
import type { HttpRequest, HttpResponseInit } from '@azure/functions'
import { getEiaApiKey } from '../shared/config'
import { DatabaseUnavailableError, query, sql } from '../shared/db'
import { EIA_ALLOWED_AREAS, EIA_ALLOWED_PRODUCTS, fetchEiaLatest, fetchEiaWeekly } from '../shared/eia'
import { error, fromException, json } from '../shared/http'
import { validateSession } from '../shared/session'
import { FUEL_PRICE_MAX_RANGE_DAYS } from '../shared/types'
import type { FuelPricePoint, GetFuelPricesResponse } from '../shared/types'

const DAY_MS = 86_400_000
const EARLIEST_WEEK = '1990-08-20'
const STALE_AFTER_MS = 24 * 60 * 60 * 1000
const WEEK_FORMAT = /^\d{4}-\d{2}-\d{2}$/

/** area|product -> first week EIA actually has, recorded when a fetch starts later than asked. */
const seriesStart = new Map<string, string>()

function parseDate(v: string | null): number | null {
  if (!v || !WEEK_FORMAT.test(v)) return null
  const ms = Date.parse(`${v}T00:00:00Z`)
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== v) return null
  return ms
}

const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const addDays = (date: string, days: number) => fmt(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
const daysBetween = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS
const maxDate = (a: string, b: string) => (a > b ? a : b)
const minDate = (a: string, b: string) => (a < b ? a : b)

type Row = { week: string; price: number | string }
type NewestRow = Row & { fetched_at: Date | string | null }

const toPoint = (r: Row): FuelPricePoint => ({ week: r.week, price: Number(r.price) })

const WINDOW_SQL = `SELECT CONVERT(varchar(10), week, 23) AS week, price FROM dbo.fuel_price_weekly
  WHERE area = @area AND product = @product AND week >= @start AND week <= @end ORDER BY week ASC`
const NEWEST_SQL = `SELECT TOP 1 CONVERT(varchar(10), week, 23) AS week, price, fetched_at FROM dbo.fuel_price_weekly
  WHERE area = @area AND product = @product ORDER BY week DESC`
const UPSERT_SQL = `MERGE dbo.fuel_price_weekly WITH (HOLDLOCK) AS t
USING (SELECT @area AS area, @product AS product, CAST(j.week AS date) AS week, CAST(j.price AS decimal(6,3)) AS price
       FROM OPENJSON(@points) WITH (week varchar(10) '$.week', price float '$.price') AS j) AS s
ON t.area = s.area AND t.product = s.product AND t.week = s.week
WHEN MATCHED THEN UPDATE SET price = s.price, fetched_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT (area, product, week, price, fetched_at)
  VALUES (s.area, s.product, s.week, s.price, SYSUTCDATETIME());`

function keyParams(area: string, product: string) {
  return {
    area: { type: sql.NVarChar(8), value: area },
    product: { type: sql.NVarChar(16), value: product },
  }
}

async function readCache(area: string, product: string, start: string, end: string) {
  const [win, newest] = await Promise.all([
    query<Row>(WINDOW_SQL, {
      ...keyParams(area, product),
      start: { type: sql.VarChar(10), value: start },
      end: { type: sql.VarChar(10), value: end },
    }),
    query<NewestRow>(NEWEST_SQL, keyParams(area, product)),
  ])
  return { rows: win.recordset.map(toPoint), newest: newest.recordset[0] ?? null }
}

function isStale(
  key: string,
  w0: string,
  to: string,
  rows: FuelPricePoint[],
  newest: NewestRow | null,
  now: number,
): boolean {
  if (!newest) return true
  const fetchedAt = newest.fetched_at ? new Date(newest.fetched_at).getTime() : 0
  if (now - fetchedAt > STALE_AFTER_MS && to >= newest.week) return true
  if (w0 > newest.week) return false
  const end = minDate(to, newest.week)
  const recorded = seriesStart.get(key)
  const from = recorded ? maxDate(w0, recorded) : w0
  if (from > end) return false
  const weeks = rows.map((r) => r.week).filter((w) => w >= from && w <= end)
  if (weeks.length === 0) return true
  if (daysBetween(from, weeks[0]) > 6) return true
  if (daysBetween(weeks[weeks.length - 1], end) > 6) return true
  for (let i = 1; i < weeks.length; i += 1) {
    if (daysBetween(weeks[i - 1], weeks[i]) > 14) return true
  }
  return false
}

async function refreshFromEia(apiKey: string, area: string, product: string, w0: string, to: string) {
  const key = `${area}|${product}`
  const [weekly, latest] = await Promise.all([
    fetchEiaWeekly(apiKey, area, product, w0, to),
    fetchEiaLatest(apiKey, area, product),
  ])
  const byWeek = new Map<string, number>()
  for (const p of [...weekly, ...(latest ? [latest] : [])]) {
    if (WEEK_FORMAT.test(p.week)) byWeek.set(p.week, p.price)
  }
  if (byWeek.size > 0) {
    const points = [...byWeek].map(([week, price]) => ({ week, price }))
    await query(UPSERT_SQL, {
      ...keyParams(area, product),
      points: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(points) },
    })
  }
  const first = weekly.find((p) => WEEK_FORMAT.test(p.week))?.week
  if (first && first > addDays(w0, 6)) {
    const known = seriesStart.get(key)
    seriesStart.set(key, known && known < first ? known : first)
  }
}

export async function getFuelPrices(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const user = await validateSession(req)
    if (!user) return error(401, 'Unauthorized')

    const area = req.query.get('area')
    const product = req.query.get('product')
    const from = req.query.get('from')
    const to = req.query.get('to')
    if (!area || !EIA_ALLOWED_AREAS.includes(area)) return error(400, 'area is not supported')
    if (!product || !EIA_ALLOWED_PRODUCTS.includes(product)) return error(400, 'product is not supported')
    const fromMs = parseDate(from)
    const toMs = parseDate(to)
    if (fromMs === null || toMs === null || !from || !to) return error(400, 'from and to must be YYYY-MM-DD dates')
    if (fromMs > toMs) return error(400, 'from must not be after to')
    if ((toMs - fromMs) / DAY_MS > FUEL_PRICE_MAX_RANGE_DAYS) {
      return error(400, `date range must not exceed ${FUEL_PRICE_MAX_RANGE_DAYS} days`)
    }

    const w0 = maxDate(addDays(from, -7), EARLIEST_WEEK)
    const apiKey = getEiaApiKey()
    let cache = await readCache(area, product, w0, to)

    if (apiKey && isStale(`${area}|${product}`, w0, to, cache.rows, cache.newest, Date.now())) {
      try {
        await refreshFromEia(apiKey, area, product, w0, to)
        cache = await readCache(area, product, w0, to)
      } catch (err) {
        console.warn('EIA refresh failed:', err instanceof Error ? err.name : 'Error')
        // A database outage must still surface as 503 rather than silently serving stale data.
        if (err instanceof DatabaseUnavailableError) throw err
      }
    }

    const body: GetFuelPricesResponse = {
      area,
      product,
      configured: apiKey !== null,
      points: cache.rows,
      latest: cache.newest ? toPoint(cache.newest) : null,
    }
    return json(body)
  } catch (err) {
    return fromException(err)
  }
}

app.http('getFuelPrices', { route: 'fuel-prices', methods: ['GET'], authLevel: 'anonymous', handler: getFuelPrices })
