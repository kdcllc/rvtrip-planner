import type { TripStop } from '../../domain/trip/types'

/**
 * Validation result for stops before creating Google Maps URL
 */
export type MapsValidationResult = {
  valid: boolean
  error?: string
  validStops: TripStop[]
}

/**
 * Validate stops for Google Maps URL generation
 * @param stops - Array of trip stops to validate
 * @returns Validation result with valid stops and any error message
 */
export function validateStopsForMaps(stops: TripStop[]): MapsValidationResult {
  // Filter to stops with valid coordinates
  const validStops = stops.filter(
    (stop) => stop.location?.lat != null && stop.location?.lng != null
  )

  if (validStops.length === 0) {
    return {
      valid: false,
      error: 'No stops have valid coordinates. Please add addresses and wait for geocoding.',
      validStops: [],
    }
  }

  if (validStops.length > 11) {
    return {
      valid: false,
      error: 'Google Maps supports maximum 11 locations. Please select 11 or fewer stops.',
      validStops,
    }
  }

  return {
    valid: true,
    validStops,
  }
}

/**
 * Build a Google Maps directions URL from trip stops
 * @param stops - Array of trip stops
 * @param selectedIndices - Optional array of indices to include (for partial routes)
 * @returns Google Maps URL string
 * @throws Error if validation fails
 */
export function buildGoogleMapsDirectionsUrl(
  stops: TripStop[],
  selectedIndices?: number[]
): string {
  // Filter stops if selection provided
  const stopsToInclude = selectedIndices
    ? selectedIndices.map((i) => stops[i]).filter(Boolean)
    : stops

  // Validate stops
  const validation = validateStopsForMaps(stopsToInclude)
  if (!validation.valid) {
    throw new Error(validation.error)
  }

  const validStops = validation.validStops

  // Single stop - show on map
  if (validStops.length === 1) {
    const stop = validStops[0]
    return `https://www.google.com/maps/search/?api=1&query=${stop.location!.lat},${stop.location!.lng}`
  }

  // Multiple stops - create directions with waypoints
  const origin = `${validStops[0].location!.lat},${validStops[0].location!.lng}`
  const destination = `${validStops[validStops.length - 1].location!.lat},${validStops[validStops.length - 1].location!.lng}`

  const waypoints = validStops
    .slice(1, -1)
    .map((stop) => `${stop.location!.lat},${stop.location!.lng}`)
    .join('|')

  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`

  if (waypoints) {
    url += `&waypoints=${waypoints}`
  }

  url += '&travelmode=driving'

  return url
}

/**
 * Open Google Maps in a new tab
 * @param url - Google Maps URL to open
 */
export function openInGoogleMaps(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Copy Google Maps URL to clipboard
 * @param url - Google Maps URL to copy
 * @returns Promise that resolves to true if successful, false otherwise
 */
export async function copyMapsUrlToClipboard(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch (err) {
    console.error('Failed to copy to clipboard:', err)
    return false
  }
}
