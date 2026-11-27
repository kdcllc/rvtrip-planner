import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TripStop } from '../../domain/trip/types'
import { fetchStopForecast, resetClimateRequestQueueForTests } from './weatherService'

const makeStop = (id: string, lat: number): TripStop =>
  ({
    id,
    name: `Stop ${id}`,
    location: { lat, lng: -81.12 },
    startDate: '2026-09-24',
    endDate: '2026-09-25',
  }) as unknown as TripStop

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

const climateBody = {
  daily: {
    time: ['2026-09-24', '2026-09-25'],
    temperature_2m_max: [80.4, 78.6],
    temperature_2m_min: [60.2, 58.9],
    precipitation_sum: [0, 1],
    relative_humidity_2m_mean: [55, 70],
  },
}

// NOAA answers with no periods, so the whole stay comes from the climate API.
const routeFetch = (climate: () => Response) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('https://api.weather.gov/points')) {
      return jsonResponse({ properties: { forecast: 'https://noaa.test/forecast', timeZone: 'America/New_York' } })
    }
    if (url.startsWith('https://noaa.test/forecast')) {
      return jsonResponse({ properties: { periods: [] } })
    }
    return climate()
  })

const climateCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(
    ([input]) => new URL(String(input)).hostname === 'climate-api.open-meteo.com',
  )

describe('fetchStopForecast climate normals', () => {
  beforeEach(() => {
    localStorage.clear()
    resetClimateRequestQueueForTests()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('retries after HTTP 429, honouring Retry-After, and returns the climate days', async () => {
    let calls = 0
    const fetchMock = routeFetch(() =>
      ++calls === 1 ? jsonResponse({}, 429, { 'Retry-After': '3' }) : jsonResponse(climateBody),
    )
    vi.stubGlobal('fetch', fetchMock)

    const pending = fetchStopForecast(makeStop('a', 36.51))
    await vi.advanceTimersByTimeAsync(2999)
    expect(climateCalls(fetchMock)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    const forecast = await pending

    expect(climateCalls(fetchMock)).toHaveLength(2)
    expect(forecast.days.map((d) => d.date)).toEqual(['2026-09-24', '2026-09-25'])
    expect(forecast.days[0]).toMatchObject({ min: 60, max: 80, isHistorical: true })
  })

  it('gives up after the retry limit and reports no weather data', async () => {
    const fetchMock = routeFetch(() => jsonResponse({}, 429))
    vi.stubGlobal('fetch', fetchMock)

    const pending = fetchStopForecast(makeStop('a', 36.51))
    const assertion = expect(pending).rejects.toThrow('No weather data available')
    await vi.advanceTimersByTimeAsync(60000)
    await assertion
    expect(climateCalls(fetchMock)).toHaveLength(4)
  })

  it('serves a repeated lookup from the cache without calling the climate API again', async () => {
    const fetchMock = routeFetch(() => jsonResponse(climateBody))
    vi.stubGlobal('fetch', fetchMock)

    await fetchStopForecast(makeStop('a', 36.51))
    await vi.advanceTimersByTimeAsync(1000)
    const again = await fetchStopForecast(makeStop('a', 36.51))

    expect(climateCalls(fetchMock)).toHaveLength(1)
    expect(again.days).toHaveLength(2)
  })

  it('does not cache a failed lookup', async () => {
    let calls = 0
    const fetchMock = routeFetch(() =>
      ++calls === 1 ? jsonResponse({}, 500) : jsonResponse(climateBody),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchStopForecast(makeStop('a', 36.51))).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(1000)
    const second = await fetchStopForecast(makeStop('a', 36.51))

    expect(climateCalls(fetchMock)).toHaveLength(2)
    expect(second.days).toHaveLength(2)
  })

  it('sends climate requests for different stops one at a time', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('https://api.weather.gov/points')) {
        return jsonResponse({ properties: { forecast: 'https://noaa.test/forecast' } })
      }
      if (url.startsWith('https://noaa.test/forecast')) {
        return jsonResponse({ properties: { periods: [] } })
      }
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 100))
      inFlight -= 1
      return jsonResponse(climateBody)
    })
    vi.stubGlobal('fetch', fetchMock)

    const all = Promise.all(
      [36.1, 36.2, 36.3].map((lat, i) => fetchStopForecast(makeStop(String(i), lat))),
    )
    await vi.advanceTimersByTimeAsync(5000)
    const results = await all

    expect(results).toHaveLength(3)
    expect(climateCalls(fetchMock)).toHaveLength(3)
    expect(maxInFlight).toBe(1)
  })
})
