import type { TripStop } from '../domain/trip/types'

/**
 * Calculate fuel cost between two points
 */
export const calculateFuelCost = (
  distanceMeters: number | undefined,
  mpg: number,
  gasPricePerGallon: number | undefined
): number | undefined => {
  if (!distanceMeters || !gasPricePerGallon || mpg <= 0) {
    return undefined
  }

  const miles = distanceMeters / 1609.344
  const gallonsNeeded = miles / mpg
  const cost = gallonsNeeded * gasPricePerGallon

  return Math.round(cost * 100) / 100 // Round to 2 decimal places
}

/**
 * Calculate total fuel cost for a trip
 */
export const calculateTripTotalFuelCost = (stops: TripStop[]): number => {
  return stops.reduce((total, stop) => {
    return total + (stop.estimatedFuelCost ?? 0)
  }, 0)
}

/**
 * Update stops with estimated fuel costs
 * Requires distances and gas price to already be available
 */
export const calculateStopCosts = (
  stops: TripStop[],
  mpg: number,
  gasPricePerGallon: number
): TripStop[] => {
  return stops.map((stop) => ({
    ...stop,
    estimatedFuelCost: calculateFuelCost(
      stop.distanceFromPreviousMeters,
      mpg,
      gasPricePerGallon
    ),
  }))
}
