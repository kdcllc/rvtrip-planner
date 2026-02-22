import type { GasPriceLookupResult } from '../../domain/gas/types'
import { FreeGasPriceAdapter } from './freeGasPriceAdapter'
import { HardcodedGasPriceAdapter } from './hardcodedGasPriceAdapter'

/**
 * Gas price service with adapter pattern
 * Tries free API first, falls back to hardcoded mapping
 * Caches results per state per day
 */
class GasPriceService {
  private primaryAdapter = new FreeGasPriceAdapter()
  private fallbackAdapter = new HardcodedGasPriceAdapter()
  private cache: Map<string, GasPriceLookupResult & { expiresAt: number }> =
    new Map()
  private readonly CACHE_DURATION_MS = 6 * 60 * 60 * 1000 // 6 hours for real-time API data

  /**
   * Get gas price for a state, trying primary adapter then fallback
   */
  async getPriceForState(state: string): Promise<GasPriceLookupResult> {
    const stateCode = state.toUpperCase().slice(0, 2)
    const cacheKey = `${stateCode}|${this.getCacheDateKey()}`

    // Check cache first
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return {
        state: cached.state,
        pricePerGallon: cached.pricePerGallon,
        source: cached.source,
        fetchedAt: cached.fetchedAt,
        error: cached.error,
      }
    }

    // Try primary adapter (free API)
    const primaryResult = await this.primaryAdapter.getPriceForState(state)

    // If primary has no error and valid price, use it
    if (!primaryResult.error && primaryResult.pricePerGallon > 0) {
      this.cacheResult(cacheKey, primaryResult)
      return primaryResult
    }

    // Fallback to hardcoded adapter
    const fallbackResult = await this.fallbackAdapter.getPriceForState(state)
    this.cacheResult(cacheKey, fallbackResult)

    // If fallback also failed, note both sources
    if (fallbackResult.error) {
      return {
        ...fallbackResult,
        error: `Primary: ${primaryResult.error}. Fallback: ${fallbackResult.error}`,
      }
    }

    return fallbackResult
  }

  /**
   * Clear all cached prices (useful for testing or manual refresh)
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics for debugging
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    }
  }

  /**
   * Cache a result with expiration
   */
  private cacheResult(
    key: string,
    result: GasPriceLookupResult
  ): void {
    this.cache.set(key, {
      ...result,
      expiresAt: Date.now() + this.CACHE_DURATION_MS,
    })
  }

  /**
   * Get cache key for today (to cache per calendar day)
   */
  private getCacheDateKey(): string {
    const today = new Date()
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  }
}

// Export singleton instance
export const gasPriceService = new GasPriceService()
