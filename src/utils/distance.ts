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
  destination: { lat: number; lng: number },
  apiKey: string
): Promise<DistanceResult> => {
  try {
    const routeResponse = await computeRoute(
      {
        origin,
        destination,
        avoidTolls: false,
        avoidHighways: false,
        avoidFerries: false,
      },
      apiKey
    )

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
export const calculateTripDistances = async (
  stops: TripStop[],
  apiKey: string
): Promise<TripStop[]> => {
  const validStops = stops.filter((stop) => stop.location)

  if (validStops.length < 2) {
    return stops
  }

  const updatedStops = [...stops]

  // Fetch all inter-stop distances in parallel for better performance
  const distancePromises = validStops.slice(1).map((currentStop, idx) => {
    const prevStop = validStops[idx]
    if (!prevStop.location || !currentStop.location) {
      return Promise.resolve(null)
    }
    return fetchDistanceBetweenStops(
      prevStop.location,
      currentStop.location,
      apiKey
    ).catch((error) => {
      console.error(`Failed to calculate distance for stop ${idx + 1}:`, error)
      return null
    })
  })

  const distances = await Promise.all(distancePromises)

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
