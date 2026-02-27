import { fetchWithBackoff } from '../network/request'
import type { RouteRequest, RouteResponse, RoutingProvider } from './routesService'

export type OpenSourceRoutingOptions = {
  openRouteServiceApiKey?: string
}

const OSRM_BASE_URL = 'https://router.project-osrm.org/route/v1/driving'
const OSRM_FALLBACK_URL = 'https://routing.openstreetmap.de/routed-car/route/v1/driving'
const ORS_URL = 'https://api.openrouteservice.org/v2/directions/driving-car'

const toOsrmCoords = (request: RouteRequest) =>
  `${request.origin.lng},${request.origin.lat};${request.destination.lng},${request.destination.lat}`

const parseOsrmRoute = (data: unknown): RouteResponse | null => {
  const route = (data as { routes?: Array<{ geometry?: string; legs?: Array<{ distance?: number; duration?: number }> }> })
    ?.routes?.[0]

  const geometry = route?.geometry
  const leg = route?.legs?.[0]

  if (!geometry || !leg) {
    return null
  }

  return {
    polyline: geometry,
    distanceMeters: leg.distance ?? 0,
    duration: `${Math.round(leg.duration ?? 0)}s`,
  }
}

const parseOrsRoute = (data: unknown): RouteResponse | null => {
  const route = (data as { routes?: Array<{ geometry?: string; segments?: Array<{ distance?: number; duration?: number }> }> })
    ?.routes?.[0]

  const geometry = route?.geometry
  const segment = route?.segments?.[0]

  if (!geometry || !segment) {
    return null
  }

  return {
    polyline: geometry,
    distanceMeters: segment.distance ?? 0,
    duration: `${Math.round(segment.duration ?? 0)}s`,
  }
}

const buildOrsAvoidFeatures = (request: RouteRequest) => {
  const avoid: string[] = []
  if (request.avoidTolls) {
    avoid.push('tollways')
  }
  if (request.avoidHighways) {
    avoid.push('highways')
  }
  if (request.avoidFerries) {
    avoid.push('ferries')
  }
  return avoid.length > 0 ? avoid : undefined
}

export const createOpenSourceRoutingProvider = (
  options: OpenSourceRoutingOptions = {}
): RoutingProvider => {
  const { openRouteServiceApiKey } = options

  return {
    id: 'open-source-routing',
    // Note: Route requests are automatically batched at the caller level
    // (see calculateTripDistances) to avoid overwhelming free public APIs
    computeRoute: async (request: RouteRequest): Promise<RouteResponse> => {
      // Try primary OSRM server
      const osrmUrls = [OSRM_BASE_URL, OSRM_FALLBACK_URL]
      
      for (const baseUrl of osrmUrls) {
        const osrmUrl = `${baseUrl}/${toOsrmCoords(request)}?overview=full&geometries=polyline&steps=false`

        try {
          const response = await fetchWithBackoff(osrmUrl, {}, {
            retries: 1,
            baseDelayMs: 300,
            maxDelayMs: 2000,
            timeoutMs: 10000,
          })

          if (response.ok) {
            const data = await response.json()
            const parsed = parseOsrmRoute(data)
            if (parsed) {
              console.log(`✓ Route fetched from OSRM: ${baseUrl} (${(parsed.distanceMeters / 1609.344).toFixed(1)} mi, ${parsed.duration})`)
              return parsed
            }
          } else {
            console.warn(`OSRM routing error (${baseUrl}):`, response.status)
          }
        } catch (error) {
          console.warn(`OSRM request failed (${baseUrl}):`, error instanceof Error ? error.message : 'Unknown error')
          // Continue to next OSRM server or ORS
        }
      }

      // All OSRM servers failed, try ORS if key available
      if (!openRouteServiceApiKey) {
        throw new Error('Routing unavailable. OSRM servers unreachable. Get a free OpenRouteService API key at https://openrouteservice.org for fallback routing.')
      }

      const orsBody = {
        coordinates: [
          [request.origin.lng, request.origin.lat],
          [request.destination.lng, request.destination.lat],
        ],
        instructions: false,
        geometry: true,
        geometry_simplify: false,
        avoid_features: buildOrsAvoidFeatures(request),
      }

      const orsResponse = await fetchWithBackoff(
        ORS_URL,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: openRouteServiceApiKey,
          },
          body: JSON.stringify(orsBody),
        },
        {
          retries: 2,
          baseDelayMs: 600,
          maxDelayMs: 6000,
        }
      )

      if (!orsResponse.ok) {
        const errorText = await orsResponse.text()
        console.warn('OpenRouteService error:', orsResponse.status, errorText)
        throw new Error(`OpenRouteService returned ${orsResponse.status}`)
      }

      const orsData = await orsResponse.json()
      const parsed = parseOrsRoute(orsData)

      if (!parsed) {
        throw new Error('OpenRouteService response missing route data')
      }

      console.log(`✓ Route fetched from OpenRouteService (${(parsed.distanceMeters / 1609.344).toFixed(1)} mi, ${parsed.duration})`)
      return parsed
    },
  }
}
