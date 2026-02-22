import type { TripStop } from '../../domain/trip/types'
import type { StopForecast, DailyForecast } from '../../domain/weather/types'
import { getWeatherCondition } from '../../utils/weather'

const NOAA_POINTS_BASE = 'https://api.weather.gov/points'
const CLIMATE_API_BASE = 'https://climate-api.open-meteo.com/v1/climate'

export const makeForecastCacheKey = (stop: TripStop) => {
  if (!stop.location || !stop.startDate || !stop.endDate) {
    return ''
  }

  return `${stop.location.lat},${stop.location.lng}|${stop.startDate}|${stop.endDate}`
}

const getGridData = async (lat: number, lng: number) => {
  const response = await fetch(`${NOAA_POINTS_BASE}/${lat},${lng}`)
  if (!response.ok) {
    throw new Error('Unable to get NOAA grid data for this location')
  }

  const data = await response.json()
  if (!data?.properties?.forecast) {
    throw new Error('NOAA grid data missing forecast URL')
  }

  return { url: data.properties.forecast, timezone: data.properties.timeZone }
}

const getClimateNormals = async (
  lat: number,
  lng: number,
  dates: string[],
): Promise<DailyForecast[]> => {
  if (dates.length === 0) {
    return []
  }

  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lng.toString(),
    start_date: dates[0],
    end_date: dates[dates.length - 1],
    daily:
      'temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean',
    temperature_unit: 'fahrenheit',
  })

  try {
    const response = await fetch(`${CLIMATE_API_BASE}?${params.toString()}`)
    if (!response.ok) {
      return []
    }

    const data = await response.json()
    if (!data?.daily?.time) {
      return []
    }

    return data.daily.time.map((date: string, index: number) => {
      const min = Math.round(data.daily.temperature_2m_min[index])
      const max = Math.round(data.daily.temperature_2m_max[index])
      const precipChance = data.daily.relative_humidity_2m_mean
        ? Math.round(data.daily.relative_humidity_2m_mean[index])
        : null
      const avgTemp = (min + max) / 2

      return {
        date,
        min,
        max,
        precipChance,
        weatherCondition: getWeatherCondition(precipChance, avgTemp),
        isHistorical: true,
      }
    })
  } catch {
    return []
  }
}

export const fetchStopForecast = async (stop: TripStop): Promise<StopForecast> => {
  if (!stop.location) {
    throw new Error('Stop has no coordinates yet')
  }

  if (!stop.startDate || !stop.endDate) {
    throw new Error('Stop dates are missing')
  }

  // Get the forecast URL for this location's grid point
  const { url: forecastUrl, timezone } = await getGridData(
    stop.location.lat,
    stop.location.lng,
  )

  // Fetch the actual forecast data from NOAA
  const forecastResponse = await fetch(forecastUrl)
  if (!forecastResponse.ok) {
    throw new Error('Unable to fetch NOAA weather data')
  }

  const forecastData = await forecastResponse.json()
  if (!forecastData?.properties?.periods) {
    throw new Error('Weather data missing for this stop')
  }

  // Parse NOAA periods and group by date
  // NOAA returns 12-hour periods (day and night), so we need to aggregate
  const dateMap = new Map<
    string,
    { min: number; max: number; precipChance: number | null }
  >()

  type NoaaPeriod = {
    startTime: string
    temperature: number
    probabilityOfPrecipitation?: { value?: number | null } | null
  }

  ;(forecastData.properties.periods as NoaaPeriod[]).forEach((period) => {
    const startTime = new Date(period.startTime)
    const dateStr = startTime.toISOString().split('T')[0]

    if (!dateMap.has(dateStr)) {
      dateMap.set(dateStr, {
        min: period.temperature,
        max: period.temperature,
        precipChance: period.probabilityOfPrecipitation?.value ?? null,
      })
    } else {
      const existing = dateMap.get(dateStr)!
      existing.min = Math.min(existing.min, period.temperature)
      existing.max = Math.max(existing.max, period.temperature)
    }
  })

  // Convert NOAA data to array and filter by date range
  const noaaForecasts: DailyForecast[] = Array.from(dateMap.entries())
    .filter(([date]) => date >= stop.startDate && date <= stop.endDate)
    .map(([date, temps]) => {
      const min = Math.round(temps.min)
      const max = Math.round(temps.max)
      const avgTemp = (min + max) / 2

      return {
        date,
        min,
        max,
        precipChance: temps.precipChance,
        weatherCondition: getWeatherCondition(temps.precipChance, avgTemp),
        isHistorical: false,
      }
    })

  // Check if we need climate normals (dates beyond NOAA's forecast range)
  // NOAA provides ~16 days, then fall back to climate normals
  let allDays: DailyForecast[] = [...noaaForecasts]

  if (noaaForecasts.length > 0) {
    const lastForecastDate = noaaForecasts[noaaForecasts.length - 1].date
    if (lastForecastDate < stop.endDate) {
      // Need climate normals for remaining dates
      const nextDate = new Date(lastForecastDate)
      nextDate.setDate(nextDate.getDate() + 1)
      const remainingDates: string[] = []

      const current = new Date(nextDate)
      const end = new Date(stop.endDate)
      while (current <= end) {
        remainingDates.push(current.toISOString().split('T')[0])
        current.setDate(current.getDate() + 1)
      }

      if (remainingDates.length > 0) {
        const normals = await getClimateNormals(
          stop.location.lat,
          stop.location.lng,
          remainingDates,
        )
        allDays = [...allDays, ...normals]
      }
    }
  } else {
    // If NOAA forecast is empty, try to get climate normals for entire range
    const allRequestedDates: string[] = []
    const current = new Date(stop.startDate)
    const end = new Date(stop.endDate)
    while (current <= end) {
      allRequestedDates.push(current.toISOString().split('T')[0])
      current.setDate(current.getDate() + 1)
    }

    if (allRequestedDates.length > 0) {
      const normals = await getClimateNormals(
        stop.location.lat,
        stop.location.lng,
        allRequestedDates,
      )
      allDays = [...normals]
    }
  }

  if (allDays.length === 0) {
    throw new Error('No weather data available for this stop')
  }

  return {
    stopId: stop.id,
    cacheKey: makeForecastCacheKey(stop),
    timezone: timezone ?? 'UTC',
    days: allDays,
    updatedAt: new Date().toISOString(),
  }
}
