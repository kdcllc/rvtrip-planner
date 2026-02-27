import { LruTtlCache } from '../network/cache'
import { fetchWithBackoff } from '../network/request'

export type GeocodingResult = {
  address: string
  location: { lat: number; lng: number }
}

export type GeocodingProvider = {
  id: string
  geocode: (address: string) => Promise<GeocodingResult | null>
}

const GEOCODING_CACHE_SIZE = 100
const GEOCODING_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const GEOCODING_CACHE_STORAGE_KEY = 'tripPlanner.geocoding.cache.v1'

const geocodingCache = new LruTtlCache<GeocodingResult>(
  GEOCODING_CACHE_SIZE,
  GEOCODING_CACHE_TTL_MS,
  GEOCODING_CACHE_STORAGE_KEY
)

let activeProvider: GeocodingProvider | null = null

export const setGeocodingProvider = (provider: GeocodingProvider) => {
  activeProvider = provider
}

const PHOTON_BASE_URL = 'https://photon.komoot.io/api'
const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org/search'

const parsePhotonResult = (data: unknown): GeocodingResult | null => {
  const feature = (data as { 
    features?: Array<{ 
      properties?: { 
        name?: string
        housenumber?: string
        street?: string
        city?: string
        state?: string
        country?: string
        postcode?: string
      }
      geometry?: { coordinates?: [number, number] } 
    }> 
  })?.features?.[0]

  if (!feature?.geometry?.coordinates) {
    return null
  }

  const props = feature.properties
  
  // Build complete address with all components
  const streetAddress = [props?.housenumber, props?.street].filter(Boolean).join(' ')
  const addressParts = [
    props?.name,
    streetAddress,
    props?.city,
    props?.state,
    props?.postcode,
    props?.country,
  ].filter(Boolean)

  return {
    address: addressParts.join(', ') || 'Unknown location',
    location: {
      lng: feature.geometry.coordinates[0],
      lat: feature.geometry.coordinates[1],
    },
  }
}

const parseNominatimResult = (data: unknown): GeocodingResult | null => {
  const result = (data as Array<{ display_name?: string; lat?: string; lon?: string }>)?.[0]

  if (!result?.lat || !result?.lon) {
    return null
  }

  return {
    address: result.display_name || 'Unknown location',
    location: {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
    },
  }
}

const shouldUseFallback = (error: unknown, response?: Response): boolean => {
  if (response && response.status >= 400 && response.status < 500 && response.status !== 429) {
    return false
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return true
  }

  return true
}

export const createOpenSourceGeocodingProvider = (): GeocodingProvider => {
  return {
    id: 'open-source-geocoding',
    geocode: async (address: string): Promise<GeocodingResult | null> => {
      const trimmed = address.trim()
      if (!trimmed) {
        return null
      }

      const photonUrl = `${PHOTON_BASE_URL}/?q=${encodeURIComponent(trimmed)}&limit=1`

      try {
        const response = await fetchWithBackoff(
          photonUrl,
          {},
          {
            retries: 2,
            baseDelayMs: 400,
            maxDelayMs: 3000,
          }
        )

        if (!response.ok) {
          console.warn('Photon geocoding error:', response.status)
          if (!shouldUseFallback(null, response)) {
            return null
          }
        } else {
          const data = await response.json()
          const parsed = parsePhotonResult(data)
          if (parsed) {
            return parsed
          }
        }
      } catch (error) {
        console.warn('Photon geocoding failed:', error)
        if (!shouldUseFallback(error)) {
          return null
        }
      }

      const nominatimUrl = `${NOMINATIM_BASE_URL}?q=${encodeURIComponent(trimmed)}&format=json&limit=1&addressdetails=1`

      try {
        const response = await fetchWithBackoff(
          nominatimUrl,
          {
            headers: {
              'User-Agent': 'TripPlanner/1.0',
            },
          },
          {
            retries: 2,
            baseDelayMs: 800,
            maxDelayMs: 6000,
          }
        )

        if (!response.ok) {
          console.warn('Nominatim geocoding error:', response.status)
          return null
        }

        const data = await response.json()
        const parsed = parseNominatimResult(data)
        return parsed
      } catch (error) {
        console.error('Nominatim geocoding failed:', error)
        return null
      }
    },
  }
}

export const geocodeAddress = async (address: string): Promise<GeocodingResult | null> => {
  const trimmed = address.trim()
  if (!trimmed) {
    return null
  }

  const cacheKey = trimmed.toLowerCase()
  const cached = geocodingCache.get(cacheKey)
  if (cached) {
    console.log('Geocoding cache hit for:', trimmed)
    return cached
  }

  console.log('Geocoding cache miss, calling provider for:', trimmed)

  const provider = activeProvider ?? createOpenSourceGeocodingProvider()

  try {
    const result = await provider.geocode(trimmed)
    if (result) {
      geocodingCache.set(cacheKey, result)
    }
    return result
  } catch (error) {
    console.error('Geocoding error:', error)
    return null
  }
}

export const clearGeocodingCache = () => {
  geocodingCache.clear()
  console.log('Geocoding cache cleared')
}
