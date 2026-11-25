/**
 * Shared routing service with in-memory caching
 * Prevents duplicate computeRoutes calls between map rendering and distance calculations
 */

import { LruTtlCache } from '../network/cache'
import { createOpenSourceRoutingProvider } from './openSourceRouting'
import { OPENROUTE_API_KEY } from '../../config/env'

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

export type RoutingProvider = {
  id: string
  computeRoute: (request: RouteRequest) => Promise<RouteResponse>
}

type CacheKey = string

const MAX_CACHE_SIZE = 100
const ROUTE_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const ROUTE_CACHE_STORAGE_KEY = 'tripPlanner.routes.cache.v1'

const routeCache = new LruTtlCache<RouteResponse>(
  MAX_CACHE_SIZE,
  ROUTE_CACHE_TTL_MS,
  ROUTE_CACHE_STORAGE_KEY
)

let activeProvider: RoutingProvider | null = null

export const setRoutingProvider = (provider: RoutingProvider) => {
  activeProvider = provider
}

/**
 * Generate cache key from route request parameters
 */
const getCacheKey = (request: RouteRequest): CacheKey => {
  const { origin, destination, avoidTolls, avoidHighways, avoidFerries } = request
  return `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}|${destination.lat.toFixed(6)},${destination.lng.toFixed(6)}|${avoidTolls}|${avoidHighways}|${avoidFerries}`
}

/**
 * Compute route via the active or open-source routing provider with caching
 * Returns both polyline and distance/duration data for reuse across map + distance calculations
 */
export const computeRoute = async (
  request: RouteRequest
): Promise<RouteResponse> => {
  const cacheKey = getCacheKey(request)

  // Check cache first (24-hour TTL, persisted to localStorage)
  const cached = routeCache.get(cacheKey)
  if (cached) {
    return cached
  }

  try {
    const provider =
      activeProvider ??
      createOpenSourceRoutingProvider({ openRouteServiceApiKey: OPENROUTE_API_KEY || undefined })

    const result = await provider.computeRoute(request)

    // Cache the result immediately to persist across requests
    routeCache.set(cacheKey, result)

    return result
  } catch (error) {
    console.error('Error computing route:', error)
    throw error
  }
}
