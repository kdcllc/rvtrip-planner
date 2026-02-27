import { LruTtlCache } from '../network/cache'
import { fetchWithBackoff } from '../network/request'

export type AutocompleteSuggestion = {
  id: string
  mainText: string
  secondaryText: string
  location: { lat: number; lng: number } | null
}

export type AutocompleteResult = {
  suggestions: AutocompleteSuggestion[]
}

export type AutocompleteProvider = {
  id: string
  fetchSuggestions: (query: string) => Promise<AutocompleteResult>
}

const AUTOCOMPLETE_CACHE_SIZE = 50
const AUTOCOMPLETE_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const AUTOCOMPLETE_CACHE_STORAGE_KEY = 'tripPlanner.autocomplete.cache.v1'

const autocompleteCache = new LruTtlCache<AutocompleteResult>(
  AUTOCOMPLETE_CACHE_SIZE,
  AUTOCOMPLETE_CACHE_TTL_MS,
  AUTOCOMPLETE_CACHE_STORAGE_KEY
)

let activeProvider: AutocompleteProvider | null = null

export const setAutocompleteProvider = (provider: AutocompleteProvider) => {
  activeProvider = provider
}

const PHOTON_BASE_URL = 'https://photon.komoot.io/api'

const parsePhotonSuggestions = (data: unknown): AutocompleteResult => {
  const features = (data as { 
    features?: Array<{ 
      properties?: { 
        name?: string
        housenumber?: string
        street?: string
        city?: string
        state?: string
        country?: string
        postcode?: string
        osm_id?: number 
      }
      geometry?: { coordinates?: [number, number] } 
    }> 
  })?.features ?? []

  const suggestions: AutocompleteSuggestion[] = features
    .slice(0, 10)
    .map((feature, index) => {
      const props = feature.properties
      const coords = feature.geometry?.coordinates

      // Build complete address parts
      const streetAddress = [props?.housenumber, props?.street].filter(Boolean).join(' ')
      const mainText = props?.name || streetAddress || 'Unknown'
      
      // Build secondary text with full address
      const secondaryParts = [
        // Include street address in secondary if mainText is a POI name
        props?.name && streetAddress ? streetAddress : null,
        props?.city,
        props?.state,
        props?.postcode,
        props?.country,
      ].filter(Boolean)
      const secondaryText = secondaryParts.join(', ')

      const location = coords
        ? { lng: coords[0], lat: coords[1] }
        : null

      return {
        id: `${props?.osm_id ?? index}-${mainText}`,
        mainText,
        secondaryText,
        location,
      }
    })

  return { suggestions }
}

export const createOpenSourceAutocompleteProvider = (): AutocompleteProvider => {
  return {
    id: 'open-source-autocomplete',
    fetchSuggestions: async (query: string): Promise<AutocompleteResult> => {
      const trimmed = query.trim()
      if (!trimmed || trimmed.length < 3) {
        return { suggestions: [] }
      }

      const photonUrl = `${PHOTON_BASE_URL}/?q=${encodeURIComponent(trimmed)}&limit=10`

      try {
        const response = await fetchWithBackoff(
          photonUrl,
          {},
          {
            retries: 1,
            baseDelayMs: 300,
            maxDelayMs: 2000,
          }
        )

        if (!response.ok) {
          console.warn('Photon autocomplete error:', response.status)
          return { suggestions: [] }
        }

        const data = await response.json()
        return parsePhotonSuggestions(data)
      } catch (error) {
        console.error('Photon autocomplete failed:', error)
        return { suggestions: [] }
      }
    },
  }
}

export const fetchAutocompleteSuggestions = async (query: string): Promise<AutocompleteResult> => {
  const trimmed = query.trim()
  if (!trimmed || trimmed.length < 3) {
    return { suggestions: [] }
  }

  const cacheKey = trimmed.toLowerCase()
  const cached = autocompleteCache.get(cacheKey)
  if (cached) {
    console.log('Autocomplete cache hit for:', trimmed)
    return cached
  }

  console.log('Autocomplete cache miss, calling provider for:', trimmed)

  const provider = activeProvider ?? createOpenSourceAutocompleteProvider()

  try {
    const result = await provider.fetchSuggestions(trimmed)
    autocompleteCache.set(cacheKey, result)
    return result
  } catch (error) {
    console.error('Autocomplete error:', error)
    return { suggestions: [] }
  }
}

export const clearAutocompleteCache = () => {
  autocompleteCache.clear()
  console.log('Autocomplete cache cleared')
}
