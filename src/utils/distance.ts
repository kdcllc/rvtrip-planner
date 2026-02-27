import type { TripStop } from '../domain/trip/types'
import { computeRoute } from '../services/maps/routesService'

/**
 * Format distance in meters to a human-readable string
 */
export const formatDistance = (meters?: number): string => {
  if (meters === undefined || Number.isNaN(meters)) {
    return 'N/A'
  }
  const miles = meters / 1609.344
  if (miles < 0.1) {
    return `${Math.round(meters)} m`
  }
  return `${miles.toFixed(1)} mi`
}

/**
 * Format duration from Google Maps format (e.g., "3600s") to human-readable string
 */
export const formatDuration = (duration?: string): string => {
  if (!duration) {
    return 'N/A'
  }
  const match = duration.match(/(\d+)s/)
  if (!match) {
    return duration
  }
  const totalSeconds = Number(match[1])
  const totalMinutes = Math.round(totalSeconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remHours = hours % 24
    return `${days}d ${remHours}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

export type DistanceResult = {
  distanceMeters: number
  duration: string
}

/**
 * Calculate distance and duration between two locations using Google Maps Routes API
 * Uses the shared routes service with caching
 */
export const fetchDistanceBetweenStops = async (
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): Promise<DistanceResult> => {
  try {
    const routeResponse = await computeRoute({
      origin,
      destination,
      avoidTolls: false,
      avoidHighways: false,
      avoidFerries: false,
    })

    return {
      distanceMeters: routeResponse.distanceMeters,
      duration: routeResponse.duration,
    }
  } catch (error) {
    console.error('Error fetching distance:', error)
    throw error
  }
}

/**
 * Calculate and update distances for all consecutive stop pairs in a trip
 * Returns updated stops with distanceFromPreviousMeters populated
 */
/**
 * Process promises in batches with delay between batches
 * to avoid overwhelming free public APIs
 */
const processBatches = async <T>(
  items: Array<() => Promise<T>>,
  batchSize: number,
  delayMs: number
): Promise<T[]> => {
  const results: T[] = []
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const batchResults = await Promise.all(batch.map(fn => fn()))
    results.push(...batchResults)
    
    // Add delay between batches (except after the last batch)
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
  
  return results
}

export const calculateTripDistances = async (
  stops: TripStop[]
): Promise<TripStop[]> => {
  const validStops = stops.filter((stop) => stop.location)

  if (validStops.length < 2) {
    return stops
  }

  const updatedStops = [...stops]

  // Create route request functions (lazy execution for batching)
  const routeRequests = validStops.slice(1).map((currentStop, idx) => {
    return async () => {
      const prevStop = validStops[idx]
      if (!prevStop.location || !currentStop.location) {
        return null
      }
      
      try {
        return await fetchDistanceBetweenStops(
          prevStop.location,
          currentStop.location
        )
      } catch (error) {
        console.error(`Failed to calculate distance for stop ${idx + 1}:`, error)
        return null
      }
    }
  })

  // Process routes in batches to avoid overwhelming free APIs
  // 2 concurrent requests with 500ms delay between batches
  const distances = await processBatches(routeRequests, 2, 500)

  // Update stops with distance results
  distances.forEach((result, idx) => {
    if (result !== null) {
      const currentStop = validStops[idx + 1]
      const stopIndex = updatedStops.findIndex((s) => s.id === currentStop.id)
      if (stopIndex !== -1) {
        updatedStops[stopIndex] = {
          ...updatedStops[stopIndex],
          distanceFromPreviousMeters: result.distanceMeters,
        }
      }
    }
  })

  return updatedStops
}
