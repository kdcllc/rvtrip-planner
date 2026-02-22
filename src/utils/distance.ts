import type { TripStop } from '../domain/trip/types'

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
 * Reuses the existing pattern from TripMap.tsx
 */
export const fetchDistanceBetweenStops = async (
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  apiKey: string
): Promise<DistanceResult> => {
  const requestBody = {
    origin: {
      location: {
        latLng: {
          latitude: origin.lat,
          longitude: origin.lng,
        },
      },
    },
    destination: {
      location: {
        latLng: {
          latitude: destination.lat,
          longitude: destination.lng,
        },
      },
    },
    routeModifiers: {
      avoidTolls: false,
      avoidHighways: false,
      avoidFerries: false,
    },
    travelMode: 'DRIVE',
    computeAlternativeRoutes: false,
    languageCode: 'en-US',
  }

  try {
    const response = await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'routes.polyline.encodedPolyline,routes.legs.duration,routes.legs.distanceMeters',
        },
        body: JSON.stringify(requestBody),
      }
    )

    if (!response.ok) {
      throw new Error(`Routes API returned ${response.status}`)
    }

    const data = await response.json()

    if (!data.routes?.length) {
      throw new Error('No routes returned from API')
    }

    const route = data.routes[0]
    const leg = route.legs?.[0]

    return {
      distanceMeters: leg?.distanceMeters ?? 0,
      duration: leg?.duration ?? 'PT0S',
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

  for (let i = 1; i < validStops.length; i++) {
    const prevStop = validStops[i - 1]
    const currentStop = validStops[i]

    if (!prevStop.location || !currentStop.location) {
      continue
    }

    try {
      const result = await fetchDistanceBetweenStops(
        prevStop.location,
        currentStop.location,
        apiKey
      )

      // Find and update the current stop in the original array
      const stopIndex = updatedStops.findIndex((s) => s.id === currentStop.id)
      if (stopIndex !== -1) {
        updatedStops[stopIndex] = {
          ...updatedStops[stopIndex],
          distanceFromPreviousMeters: result.distanceMeters,
        }
      }
    } catch (error) {
      console.error(`Failed to calculate distance for stop ${i}:`, error)
      // Continue with next stop, don't fail entire calculation
    }
  }

  return updatedStops
}
