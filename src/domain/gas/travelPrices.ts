import { FUEL_PRICE_MAX_RANGE_DAYS } from '../../types/api'
import type { FuelPricePoint } from '../../types/api'
import { extractUsStateCode } from '../trip/stateCode'
import type { TripStop } from '../trip/types'
import { EIA_PRODUCT_BY_FUEL, getEiaAreaForState } from './fuelArea'
import type { FuelType } from './types'

export type FuelPriceRequest = { area: string; product: string; from: string; to: string }
export type FuelPriceResponse = {
  area: string
  product: string
  points: FuelPricePoint[]
  latest: FuelPricePoint | null
}
export type PriceBasis = 'travel-week' | 'latest' | 'fallback'
export type StopPrice = { price: number; basis: PriceBasis }
export type BasisSummary = PriceBasis | 'mixed'

type PlanStop = Pick<TripStop, 'id' | 'address' | 'startDate' | 'distanceFromPreviousMeters'>

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 86_400_000

const toDayNumber = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY)
}

const stopKey = (stop: PlanStop, startState: string | null, fuelType: FuelType) => ({
  area: getEiaAreaForState(extractUsStateCode(stop.address) ?? startState, fuelType),
  product: EIA_PRODUCT_BY_FUEL[fuelType],
})

const isPlannable = (stop: PlanStop): boolean =>
  stop.distanceFromPreviousMeters != null && DATE_PATTERN.test(stop.startDate)

export function planFuelPriceRequests(
  stops: ReadonlyArray<PlanStop>,
  startState: string | null,
  fuelType: FuelType
): FuelPriceRequest[] {
  const groups = new Map<string, { area: string; product: string; dates: Set<string> }>()
  for (const stop of stops) {
    if (!isPlannable(stop)) continue
    const { area, product } = stopKey(stop, startState, fuelType)
    const key = `${area}|${product}`
    const group = groups.get(key) ?? { area, product, dates: new Set<string>() }
    group.dates.add(stop.startDate)
    groups.set(key, group)
  }

  const requests: FuelPriceRequest[] = []
  for (const { area, product, dates } of groups.values()) {
    const sorted = [...dates].sort()
    let from = sorted[0]
    let to = sorted[0]
    for (const date of sorted.slice(1)) {
      if (toDayNumber(date) - toDayNumber(from) <= FUEL_PRICE_MAX_RANGE_DAYS) {
        to = date
      } else {
        requests.push({ area, product, from, to })
        from = date
        to = date
      }
    }
    requests.push({ area, product, from, to })
  }
  return requests
}

export function pickWeeklyPrice(
  points: ReadonlyArray<FuelPricePoint>,
  latest: FuelPricePoint | null,
  date: string
): { price: number; basis: 'travel-week' | 'latest' } | null {
  const all = latest ? [...points, latest] : [...points]
  if (all.length === 0) return null
  const day = toDayNumber(date)
  let match: FuelPricePoint | null = null
  let newest = all[0]
  for (const point of all) {
    if (point.week > newest.week) newest = point
    if (point.week <= date && (match === null || point.week > match.week)) match = point
  }
  if (match && day - toDayNumber(match.week) <= 6) {
    return { price: match.price, basis: 'travel-week' }
  }
  if (day > toDayNumber(newest.week) + 6) {
    return { price: newest.price, basis: 'latest' }
  }
  return null
}

export function buildStopPrices(
  stops: ReadonlyArray<PlanStop>,
  startState: string | null,
  fuelType: FuelType,
  responses: ReadonlyArray<FuelPriceResponse>,
  fallbackPrice: number | undefined
): Map<string, StopPrice> {
  const merged = new Map<string, { points: FuelPricePoint[]; latest: FuelPricePoint[] }>()
  for (const response of responses) {
    const key = `${response.area}|${response.product}`
    const entry = merged.get(key) ?? { points: [], latest: [] }
    entry.points.push(...response.points)
    if (response.latest) entry.latest.push(response.latest)
    merged.set(key, entry)
  }

  const result = new Map<string, StopPrice>()
  for (const stop of stops) {
    if (stop.distanceFromPreviousMeters == null) continue
    let weekly: { price: number; basis: 'travel-week' | 'latest' } | null = null
    if (DATE_PATTERN.test(stop.startDate)) {
      const { area, product } = stopKey(stop, startState, fuelType)
      const entry = merged.get(`${area}|${product}`)
      if (entry) {
        const newestLatest = entry.latest.reduce<FuelPricePoint | null>(
          (best, p) => (best === null || p.week > best.week ? p : best),
          null
        )
        weekly = pickWeeklyPrice([...entry.points, ...entry.latest], newestLatest, stop.startDate)
      }
    }
    if (weekly) {
      result.set(stop.id, weekly)
    } else if (fallbackPrice != null && fallbackPrice > 0) {
      result.set(stop.id, { price: fallbackPrice, basis: 'fallback' })
    }
  }
  return result
}

export function summariseBasis(prices: ReadonlyMap<string, StopPrice>): BasisSummary | null {
  if (prices.size === 0) return null
  const bases = new Set([...prices.values()].map((entry) => entry.basis))
  if (bases.size === 1) return [...bases][0]
  return 'mixed'
}
