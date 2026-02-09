export type DailyForecast = {
  date: string
  min: number
  max: number
  precipChance: number | null
  isHistorical?: boolean
}

export type StopForecast = {
  stopId: string
  cacheKey: string
  timezone: string
  days: DailyForecast[]
  updatedAt: string
}
