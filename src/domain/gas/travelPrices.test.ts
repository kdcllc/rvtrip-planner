import { describe, expect, it } from 'vitest'
import { FUEL_PRICE_MAX_RANGE_DAYS } from '../../types/api'
import {
  buildStopPrices,
  pickWeeklyPrice,
  planFuelPriceRequests,
  summariseBasis,
  type StopPrice,
} from './travelPrices'

const stop = (id: string, address: string, startDate: string, distance: number | null = 1000) => ({
  id,
  address,
  startDate,
  distanceFromPreviousMeters: distance ?? undefined,
})

const addDays = (date: string, days: number): string => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

describe('planFuelPriceRequests', () => {
  it('uses each stop address state for its area', () => {
    const requests = planFuelPriceRequests(
      [stop('a', 'Austin, Texas', '2025-06-02'), stop('b', 'Denver, Colorado', '2025-06-03')],
      'NY',
      'gasoline'
    )
    expect(requests).toEqual([
      { area: 'STX', product: 'EPMR', from: '2025-06-02', to: '2025-06-02' },
      { area: 'SCO', product: 'EPMR', from: '2025-06-03', to: '2025-06-03' },
    ])
  })

  it('falls back to the start state, then NUS', () => {
    expect(planFuelPriceRequests([stop('a', 'Somewhere', '2025-06-02')], 'CA', 'gasoline')[0].area).toBe('SCA')
    expect(planFuelPriceRequests([stop('a', 'Somewhere', '2025-06-02')], null, 'gasoline')[0].area).toBe('NUS')
  })

  it('maps a diesel stop in TX to R30 with the diesel product', () => {
    expect(planFuelPriceRequests([stop('a', 'Austin, Texas', '2025-06-02')], null, 'diesel')).toEqual([
      { area: 'R30', product: 'EPD2D', from: '2025-06-02', to: '2025-06-02' },
    ])
  })

  it('groups stops and takes min and max dates', () => {
    const requests = planFuelPriceRequests(
      [
        stop('a', 'Austin, Texas', '2025-06-10'),
        stop('b', 'Dallas, Texas', '2025-06-02'),
        stop('c', 'Waco, Texas', '2025-06-20'),
      ],
      null,
      'gasoline'
    )
    expect(requests).toEqual([{ area: 'STX', product: 'EPMR', from: '2025-06-02', to: '2025-06-20' }])
  })

  it('ignores stops without distance and with empty or malformed dates', () => {
    const requests = planFuelPriceRequests(
      [
        stop('a', 'Austin, Texas', '2025-06-02', null),
        stop('b', 'Austin, Texas', ''),
        stop('c', 'Austin, Texas', '2025-6-2'),
        stop('d', 'Austin, Texas', '2025-06-02T10:00'),
      ],
      null,
      'gasoline'
    )
    expect(requests).toEqual([])
  })

  it('splits a group wider than the maximum range into two requests', () => {
    const first = '2024-01-01'
    const edge = addDays(first, FUEL_PRICE_MAX_RANGE_DAYS)
    const beyond = addDays(first, FUEL_PRICE_MAX_RANGE_DAYS + 1)
    const requests = planFuelPriceRequests(
      [stop('a', 'Austin, Texas', first), stop('b', 'Austin, Texas', edge), stop('c', 'Austin, Texas', beyond)],
      null,
      'gasoline'
    )
    expect(requests).toEqual([
      { area: 'STX', product: 'EPMR', from: first, to: edge },
      { area: 'STX', product: 'EPMR', from: beyond, to: beyond },
    ])
  })
})

describe('pickWeeklyPrice', () => {
  const points = [
    { week: '2025-06-09', price: 3.2 },
    { week: '2025-06-02', price: 3.1 },
  ]

  it('returns the exact week and mid-week dates as travel-week', () => {
    expect(pickWeeklyPrice(points, null, '2025-06-02')).toEqual({ price: 3.1, basis: 'travel-week' })
    expect(pickWeeklyPrice(points, null, '2025-06-12')).toEqual({ price: 3.2, basis: 'travel-week' })
  })

  it('returns null before the first point', () => {
    expect(pickWeeklyPrice(points, null, '2025-05-30')).toBeNull()
  })

  it('returns null in a gap between points', () => {
    const gappy = [
      { week: '2025-06-02', price: 3.1 },
      { week: '2025-06-23', price: 3.4 },
    ]
    expect(pickWeeklyPrice(gappy, null, '2025-06-12')).toBeNull()
  })

  it('returns the newest point as latest for a date after it', () => {
    expect(pickWeeklyPrice(points, null, '2025-06-16')).toEqual({ price: 3.2, basis: 'latest' })
  })

  it('returns null for a past date when points are empty or earlier-ending and latest is recent', () => {
    const latest = { week: '2025-09-01', price: 3.5 }
    expect(pickWeeklyPrice([], latest, '2025-06-02')).toBeNull()
    expect(pickWeeklyPrice(points, latest, '2025-07-01')).toBeNull()
  })

  it('treats a date within 6 days after latest.week as travel-week', () => {
    const latest = { week: '2025-09-01', price: 3.5 }
    expect(pickWeeklyPrice(points, latest, '2025-09-07')).toEqual({ price: 3.5, basis: 'travel-week' })
    expect(pickWeeklyPrice(points, latest, '2025-09-08')).toEqual({ price: 3.5, basis: 'latest' })
  })

  it('returns null when there is no data at all', () => {
    expect(pickWeeklyPrice([], null, '2025-06-02')).toBeNull()
  })
})

describe('buildStopPrices', () => {
  const responses = [
    {
      area: 'STX',
      product: 'EPMR',
      points: [{ week: '2025-06-02', price: 3.1 }],
      latest: null,
    },
    {
      area: 'STX',
      product: 'EPMR',
      points: [{ week: '2025-06-09', price: 3.3 }],
      latest: null,
    },
  ]

  it('uses merged weekly prices per stop', () => {
    const prices = buildStopPrices(
      [stop('a', 'Austin, Texas', '2025-06-03'), stop('b', 'Austin, Texas', '2025-06-10')],
      null,
      'gasoline',
      responses,
      4
    )
    expect(prices.get('a')).toEqual({ price: 3.1, basis: 'travel-week' })
    expect(prices.get('b')).toEqual({ price: 3.3, basis: 'travel-week' })
  })

  it('falls back to the national price when there is no weekly price', () => {
    const prices = buildStopPrices(
      [stop('a', 'Denver, Colorado', '2025-06-03'), stop('b', 'Austin, Texas', '')],
      null,
      'gasoline',
      responses,
      4
    )
    expect(prices.get('a')).toEqual({ price: 4, basis: 'fallback' })
    expect(prices.get('b')).toEqual({ price: 4, basis: 'fallback' })
  })

  it('leaves stops absent without distance, or without weekly price and fallback', () => {
    const prices = buildStopPrices(
      [stop('a', 'Austin, Texas', '2025-06-03', null), stop('b', 'Denver, Colorado', '2025-06-03')],
      null,
      'gasoline',
      responses,
      0
    )
    expect(prices.has('a')).toBe(false)
    expect(prices.has('b')).toBe(false)
  })
})

describe('summariseBasis', () => {
  const entry = (basis: StopPrice['basis']): StopPrice => ({ price: 1, basis })

  it('summarises uniform and mixed bases', () => {
    expect(summariseBasis(new Map())).toBeNull()
    expect(summariseBasis(new Map([['a', entry('travel-week')], ['b', entry('travel-week')]]))).toBe('travel-week')
    expect(summariseBasis(new Map([['a', entry('latest')], ['b', entry('latest')]]))).toBe('latest')
    expect(summariseBasis(new Map([['a', entry('fallback')]]))).toBe('fallback')
    expect(summariseBasis(new Map([['a', entry('travel-week')], ['b', entry('fallback')]]))).toBe('mixed')
    expect(summariseBasis(new Map([['a', entry('travel-week')], ['b', entry('latest')]]))).toBe('mixed')
  })
})
