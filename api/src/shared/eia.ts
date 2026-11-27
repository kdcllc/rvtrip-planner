// EIA API v2 client for weekly US retail fuel prices. The API key travels only in the request
// query string; no error message, log line or return value ever contains it or the URL.
import type { FuelPricePoint } from './types'

// Keep in sync with EIA_AREAS in src/domain/gas/fuelArea.ts (the API cannot import frontend code).
export const EIA_ALLOWED_AREAS: readonly string[] = [
  'NUS', 'SCA', 'SCO', 'SFL', 'SMA', 'SMN', 'SNY', 'SOH', 'STX', 'SWA',
  'R1X', 'R1Y', 'R1Z', 'R20', 'R30', 'R40', 'R5XCA',
]
export const EIA_ALLOWED_PRODUCTS: readonly string[] = ['EPMR', 'EPD2D']

const EIA_URL = 'https://api.eia.gov/v2/petroleum/pri/gnd/data/'
const TIMEOUT_MS = 15_000

type FetchImpl = typeof fetch

function buildUrl(
  apiKey: string,
  area: string,
  product: string,
  direction: 'asc' | 'desc',
  length: number,
  range?: { start: string; end: string },
): string {
  const params = new URLSearchParams()
  params.set('api_key', apiKey)
  params.set('frequency', 'weekly')
  params.set('data[0]', 'value')
  params.set('facets[duoarea][]', area)
  params.set('facets[product][]', product)
  if (range) {
    params.set('start', range.start)
    params.set('end', range.end)
  }
  params.set('sort[0][column]', 'period')
  params.set('sort[0][direction]', direction)
  params.set('length', String(length))
  return `${EIA_URL}?${params.toString()}`
}

function toPoint(row: unknown): FuelPricePoint | null {
  if (typeof row !== 'object' || row === null) return null
  const r = row as { period?: unknown; value?: unknown }
  if (typeof r.period !== 'string') return null
  const price = Number(r.value)
  if (r.value === null || r.value === '' || !Number.isFinite(price) || price <= 0) return null
  return { week: r.period, price }
}

async function request(url: string, fetchImpl: FetchImpl): Promise<FuelPricePoint[]> {
  let res: Response
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error'
    throw new Error(`EIA request failed (${name})`)
  }
  if (!res.ok) throw new Error(`EIA request failed with status ${res.status}`)
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new Error('EIA response was not valid JSON')
  }
  const data = (body as { response?: { data?: unknown } } | null)?.response?.data
  if (!Array.isArray(data)) throw new Error('EIA response was malformed')
  return data.map(toPoint).filter((p): p is FuelPricePoint => p !== null)
}

/** Weekly prices for one area/product between `start` and `end` (YYYY-MM-DD), ascending by week. */
export async function fetchEiaWeekly(
  apiKey: string,
  area: string,
  product: string,
  start: string,
  end: string,
  fetchImpl: FetchImpl = fetch,
): Promise<FuelPricePoint[]> {
  return request(buildUrl(apiKey, area, product, 'asc', 5000, { start, end }), fetchImpl)
}

/** The most recent weekly price for one area/product, or null when EIA returns none. */
export async function fetchEiaLatest(
  apiKey: string,
  area: string,
  product: string,
  fetchImpl: FetchImpl = fetch,
): Promise<FuelPricePoint | null> {
  const points = await request(buildUrl(apiKey, area, product, 'desc', 1), fetchImpl)
  return points[0] ?? null
}
