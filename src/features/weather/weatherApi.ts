import type { TripStop } from '../trip/types'
import type { StopForecast } from './types'

const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast'

export const makeForecastCacheKey = (stop: TripStop) => {
  if (!stop.location || !stop.startDate || !stop.endDate) {
    return ''
  }

  return `${stop.location.lat},${stop.location.lng}|${stop.startDate}|${stop.endDate}`
}

export const fetchStopForecast = async (stop: TripStop): Promise<StopForecast> => {
  if (!stop.location) {
    throw new Error('Stop has no coordinates yet')
  }

  if (!stop.startDate || !stop.endDate) {
    throw new Error('Stop dates are missing')
  }

  const params = new URLSearchParams({
    latitude: stop.location.lat.toString(),
    longitude: stop.location.lng.toString(),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    temperature_unit: 'fahrenheit',
    timezone: 'auto',
    start_date: stop.startDate,
    end_date: stop.endDate,
  })

  const response = await fetch(`${OPEN_METEO_BASE}?${params.toString()}`)
  if (!response.ok) {
    throw new Error('Unable to fetch weather data')
  }

  const data = await response.json()
  if (!data?.daily?.time) {
    throw new Error('Weather data missing for this stop')
  }

  const days = data.daily.time.map((date: string, index: number) => ({
    date,
    min: data.daily.temperature_2m_min[index],
    max: data.daily.temperature_2m_max[index],
    precipChance: data.daily.precipitation_probability_max
      ? data.daily.precipitation_probability_max[index]
      : null,
  }))

  return {
    stopId: stop.id,
    cacheKey: makeForecastCacheKey(stop),
    timezone: data.timezone ?? 'local',
    days,
    updatedAt: new Date().toISOString(),
  }
}
