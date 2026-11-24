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
 * Helper to check if a stop has a valid query (either coordinates or address)
 * @param stop - Trip stop to validate
 * @returns True if stop can be used in a maps query
 */
function isStopValidForMaps(stop: TripStop): boolean {
  // Valid if has coordinates
  if (stop.location?.lat != null && stop.location?.lng != null) {
    return true
  }
  // Valid if has address text (will use as fallback)
  if (stop.address && stop.address.trim().length > 0) {
    return true
  }
  return false
}

/**
 * Validate stops for Google Maps URL generation
 * @param stops - Array of trip stops to validate
 * @returns Validation result with valid stops and any error message
 */
export function validateStopsForMaps(stops: TripStop[]): MapsValidationResult {
  // Filter to stops with valid coordinates or address text
  const validStops = stops.filter(isStopValidForMaps)

  if (validStops.length === 0) {
    return {
      valid: false,
      error: 'No stops have valid addresses or coordinates. Please add stops with addresses.',
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
 * Build a query string for a stop (either coordinates or address)
 * @param stop - Trip stop to build query for
 * @returns Query string for use in Google Maps URL
 */
function buildStopQuery(stop: TripStop): string {
  // Prefer coordinates if available
  if (stop.location?.lat != null && stop.location?.lng != null) {
    return `${stop.location.lat},${stop.location.lng}`
  }
  // Fall back to address text
  return encodeURIComponent(stop.address)
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
    const query = buildStopQuery(stop)
    return `https://www.google.com/maps/search/?api=1&query=${query}`
  }

  // Multiple stops - create directions with waypoints
  const origin = buildStopQuery(validStops[0])
  const destination = buildStopQuery(validStops[validStops.length - 1])

  const waypoints = validStops
    .slice(1, -1)
    .map(buildStopQuery)
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
