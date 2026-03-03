import type { WeatherCondition } from '../weather/types'
import type { TripStop } from './types'

export type TripWeatherSummary = {
  minTemp: number
  maxTemp: number
  precipChance: number | null
  condition: WeatherCondition
}

export type TripPrintStop = TripStop & {
  weatherSummary?: TripWeatherSummary
}

export type TripPrintData = {
  tripName: string
  exportedAt: string
  selectionNote?: string
  stops: TripPrintStop[]
  totalDistanceMeters?: number
  totalFuelCost?: number
  totalAccommodationCost?: number
  totalActualCost?: number
  totalActualGasCost?: number
  totalActualFoodCost?: number
  totalActualMiscCost?: number
  totalFuelDelta?: number
}
