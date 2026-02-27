import type { TripStop } from '../domain/trip/types'

/**
 * Calculate fuel cost between two points
 */
export const calculateFuelCost = (
  distanceMeters: number | undefined,
  mpg: number,
  gasPricePerGallon: number | undefined
): number | undefined => {
  if (distanceMeters == null || gasPricePerGallon == null || mpg <= 0) {
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
 * Calculate total accommodation cost for a trip
 */
export const calculateTripTotalAccommodationCost = (stops: TripStop[]): number => {
  return stops.reduce((total, stop) => {
    const nightlyCost = stop.nightlyCost ?? 0
    const nights = calculateNights(stop.startDate, stop.endDate)
    return total + (nightlyCost * nights)
  }, 0)
}

/**
 * Calculate number of nights between dates (exclusive of end date)
 */
export const calculateNights = (startDate: string, endDate: string): number => {
  try {
    const start = new Date(startDate)
    const end = new Date(endDate)
    // Check if dates are valid
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return 0
    }
    const msPerDay = 24 * 60 * 60 * 1000
    return Math.round((end.getTime() - start.getTime()) / msPerDay)
  } catch {
    return 0
  }
}

/**
 * Calculate total trip cost (fuel + accommodation)
 */
export const calculateTripTotalCost = (stops: TripStop[]): number => {
  const fuelCost = calculateTripTotalFuelCost(stops)
  const accommodationCost = calculateTripTotalAccommodationCost(stops)
  return Math.round((fuelCost + accommodationCost) * 100) / 100
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
