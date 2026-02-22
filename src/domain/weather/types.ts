export type WeatherCondition =
  | 'sunny'
  | 'partly-cloudy'
  | 'cloudy'
  | 'rainy'
  | 'stormy'
  | 'snow'
  | 'unknown'

export type DailyForecast = {
  date: string
  min: number
  max: number
  precipChance: number | null
  weatherCondition?: WeatherCondition
  isHistorical?: boolean
}

export type StopForecast = {
  stopId: string
  cacheKey: string
  timezone: string
  days: DailyForecast[]
  updatedAt: string
}
