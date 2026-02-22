import type { WeatherCondition } from '../domain/weather/types'

/**
 * Determine weather condition from precipitation chance and temperature.
 * Uses simple heuristics based on precipitation percentage and temperature thresholds.
 *
 * Classification:
 * - 0-10%: sunny
 * - 11-30%: partly cloudy
 * - 31-60%: cloudy
 * - 61-80%: rainy
 * - 81%+: stormy
 * - Temperature < 35°F triggers snow instead of rain/storm
 *
 * @param precipChance - Precipitation probability (0-100) or null if unavailable
 * @param avgTemp - Optional average temperature in Fahrenheit
 * @returns WeatherCondition type
 */
export const getWeatherCondition = (
  precipChance: number | null,
  avgTemp?: number,
): WeatherCondition => {
  // If no precipitation data, return unknown
  if (precipChance === null) {
    return 'unknown'
  }

  // Check for snow conditions (temp below 35°F with precipitation)
  const isFreezingTemp = avgTemp !== undefined && avgTemp < 35

  if (precipChance <= 10) {
    return 'sunny'
  }

  if (precipChance <= 30) {
    return 'partly-cloudy'
  }

  if (precipChance <= 60) {
    return 'cloudy'
  }

  if (precipChance <= 80) {
    return isFreezingTemp ? 'snow' : 'rainy'
  }

  // 81% or higher
  return isFreezingTemp ? 'snow' : 'stormy'
}
