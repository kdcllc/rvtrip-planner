/**
 * Shared Routes API service with in-memory caching
 * Prevents duplicate computeRoutes calls between map rendering and distance calculations
 */

export type RouteRequest = {
  origin: { lat: number; lng: number }
  destination: { lat: number; lng: number }
  avoidTolls?: boolean
  avoidHighways?: boolean
  avoidFerries?: boolean
}

export type RouteResponse = {
  polyline: string // encoded polyline
  distanceMeters: number
  duration: string // e.g., "3600s"
}

type CacheKey = string

// In-memory cache for route responses with LRU eviction
// Routes are cached indefinitely based on origin/destination coordinates
// Entries are evicted only when hitting MAX_CACHE_SIZE via LRU (least recently used)
const MAX_CACHE_SIZE = 100

type CachedEntry = {
  value: RouteResponse
}

class RouteCache {
  private map = new Map<CacheKey, CachedEntry>()

  get size() {
    return this.map.size
  }

  get(key: CacheKey): RouteResponse | undefined {
    const entry = this.map.get(key)
    if (!entry) {
      return undefined
    }

    // Refresh LRU order (move to end)
    this.map.delete(key)
    this.map.set(key, entry)

    return entry.value
  }

  set(key: CacheKey, value: RouteResponse) {
    if (this.map.has(key)) {
      this.map.delete(key)
    } else if (this.map.size >= MAX_CACHE_SIZE) {
      // Evict least recently used (oldest insertion)
      const oldestKey = this.map.keys().next().value as CacheKey | undefined
      if (oldestKey) {
        this.map.delete(oldestKey)
      }
    }

    this.map.set(key, { value })
  }

  clear() {
    this.map.clear()
  }
}

const routeCache = new RouteCache()

/**
 * Generate cache key from route request parameters
 */
const getCacheKey = (request: RouteRequest): CacheKey => {
  const { origin, destination, avoidTolls, avoidHighways, avoidFerries } = request
  return `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}|${destination.lat.toFixed(6)},${destination.lng.toFixed(6)}|${avoidTolls}|${avoidHighways}|${avoidFerries}`
}

/**
 * Compute route using Google Routes API v2 with caching
 * Returns both polyline and distance/duration data for reuse across map + distance calculations
 */
export const computeRoute = async (
  request: RouteRequest,
  apiKey: string
): Promise<RouteResponse> => {
  const cacheKey = getCacheKey(request)

  // Check cache first
  const cached = routeCache.get(cacheKey)
  if (cached) {
    console.log('Routes cache hit for:', cacheKey)
    return cached
  }

  console.log('Routes cache miss, calling API for:', cacheKey)

  const requestBody = {
    origin: {
      location: {
        latLng: {
          latitude: request.origin.lat,
          longitude: request.origin.lng,
        },
      },
    },
    destination: {
      location: {
        latLng: {
          latitude: request.destination.lat,
          longitude: request.destination.lng,
        },
      },
    },
    routeModifiers: {
      avoidTolls: request.avoidTolls ?? false,
      avoidHighways: request.avoidHighways ?? false,
      avoidFerries: request.avoidFerries ?? false,
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
      const errorText = await response.text()
      console.error('Routes API error:', response.status, errorText)
      throw new Error(`Routes API returned ${response.status}`)
    }

    const data = await response.json()

    if (!data.routes?.length) {
      throw new Error('No routes returned from API')
    }

    const route = data.routes[0]
    const polylineData = route.polyline?.encodedPolyline
    const leg = route.legs?.[0]

    if (!polylineData || !leg) {
      throw new Error('Incomplete route data from API')
    }

    const result: RouteResponse = {
      polyline: polylineData,
      distanceMeters: leg.distanceMeters ?? 0,
      duration: leg.duration ?? '0s',
    }

    // Cache the result
    routeCache.set(cacheKey, result)

    return result
  } catch (error) {
    console.error('Error computing route:', error)
    throw error
  }
}

/**
 * Clear the route cache (useful when route preferences change or for memory management)
 */
export const clearRouteCache = () => {
  routeCache.clear()
  console.log('Route cache cleared')
}

/**
 * Get current cache size (for debugging/monitoring)
 */
export const getRouteCacheSize = () => {
  return routeCache.size
}
