import type { TripPrintStop, TripWeatherSummary } from '../domain/trip/print'
import type { TripStop } from '../domain/trip/types'
import type { StopForecast } from '../domain/weather/types'
import { getWeatherCondition } from './weather'

const parseLocalDate = (value: string) => new Date(`${value}T00:00:00`)

const isValidDate = (value: Date) => !Number.isNaN(value.getTime())

const buildWeatherSummary = (
  stop: TripStop,
  forecast?: StopForecast
): TripWeatherSummary | undefined => {
  if (!forecast || !stop.startDate || !stop.endDate) {
    return undefined
  }

  const start = parseLocalDate(stop.startDate)
  const end = parseLocalDate(stop.endDate)

  if (!isValidDate(start) || !isValidDate(end)) {
    return undefined
  }

  const daysInRange = forecast.days.filter((day) => {
    const date = parseLocalDate(day.date)
    return isValidDate(date) && date >= start && date <= end
  })

  if (daysInRange.length === 0) {
    return undefined
  }

  const minTemp = Math.min(...daysInRange.map((day) => day.min))
  const maxTemp = Math.max(...daysInRange.map((day) => day.max))
  const precipValues = daysInRange
    .map((day) => day.precipChance)
    .filter((value): value is number => value !== null && value !== undefined)
  const precipChance = precipValues.length > 0 ? Math.max(...precipValues) : null
  const avgTemp = (minTemp + maxTemp) / 2

  return {
    minTemp,
    maxTemp,
    precipChance,
    condition: getWeatherCondition(precipChance, avgTemp),
  }
}

export const buildTripPrintStops = (
  stops: TripStop[],
  weatherByStopId: Record<string, StopForecast>
): TripPrintStop[] => {
  return stops.map((stop) => ({
    ...stop,
    weatherSummary: buildWeatherSummary(stop, weatherByStopId[stop.id]),
  }))
}

export const calculateTotalDistanceMeters = (stops: TripStop[]): number => {
  return stops.reduce((total, stop) => {
    return total + (stop.distanceFromPreviousMeters ?? 0)
  }, 0)
}
