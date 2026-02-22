import type { IGasPriceAdapter, GasPriceLookupResult } from '../../domain/gas/types'

/**
 * Free gas price adapter using FuelEconomy.gov national averages
 * Returns an error to trigger the hardcoded fallback when unavailable
 */
export class FreeGasPriceAdapter implements IGasPriceAdapter {
  name = 'FuelEconomy.gov (National Avg)'
  private cache: Map<string, GasPriceLookupResult & { expiresAt: number }> =
    new Map()
  private readonly CACHE_DURATION_MS = 6 * 60 * 60 * 1000 // 6 hours for real-time data

  async getPriceForState(state: string): Promise<GasPriceLookupResult> {
    const stateCode = state.toUpperCase().slice(0, 2)

    // Check cache first
    const cached = this.cache.get(stateCode)
    if (cached && cached.expiresAt > Date.now()) {
      return {
        state: cached.state,
        pricePerGallon: cached.pricePerGallon,
        source: cached.source,
        fetchedAt: cached.fetchedAt,
        error: cached.error,
      }
    }

    try {
      const price = await this.fetchNationalAveragePrice()
      if (price > 0) {
        const result: GasPriceLookupResult = {
          state: stateCode,
          pricePerGallon: price,
          source: 'FuelEconomy.gov (National Avg)',
          fetchedAt: new Date().toISOString(),
        }
        this.cacheResult(stateCode, result)
        return result
      }

      const result: GasPriceLookupResult = {
        state: stateCode,
        pricePerGallon: 0,
        source: 'FuelEconomy.gov (National Avg)',
        fetchedAt: new Date().toISOString(),
        error: 'Unable to fetch national average gas price. Using fallback.',
      }
      this.cacheResult(stateCode, result)
      return result
    } catch (error) {
      const result: GasPriceLookupResult = {
        state: stateCode,
        pricePerGallon: 0,
        source: 'FuelEconomy.gov (National Avg)',
        fetchedAt: new Date().toISOString(),
        error: `Failed to fetch gas price: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      }
      this.cacheResult(stateCode, result)
      return result
    }
  }

  /**
   * Fetch national average gasoline price from FuelEconomy.gov (XML)
   */
  private async fetchNationalAveragePrice(): Promise<number> {
    const response = await fetch('https://www.fueleconomy.gov/ws/rest/fuelprices', {
      method: 'GET',
      headers: {
        Accept: 'application/xml',
      },
    })

    if (!response.ok) {
      return 0
    }

    const xmlText = await response.text()
    const parser = new DOMParser()
    const xml = parser.parseFromString(xmlText, 'application/xml')
    const parseError = xml.querySelector('parsererror')
    if (parseError) {
      return 0
    }

    const priceText =
      xml.querySelector('regular')?.textContent?.trim() ||
      xml.querySelector('gasoline')?.textContent?.trim() ||
      ''

    const price = Number(priceText)
    if (Number.isFinite(price) && price > 0) {
      return price
    }

    return 0
  }

  /**
   * Cache a result with expiration
   */
  private cacheResult(
    stateCode: string,
    result: GasPriceLookupResult
  ): void {
    this.cache.set(stateCode, {
      ...result,
      expiresAt: Date.now() + this.CACHE_DURATION_MS,
    })
  }

  /**
   * Manually set a price in cache (useful for testing or manual updates)
   */
  setCachePrice(state: string, pricePerGallon: number): void {
    const stateCode = state.toUpperCase().slice(0, 2)
    this.cache.set(stateCode, {
      state: stateCode,
      pricePerGallon,
      source: 'Real-time Gas Prices (Manual Cache)',
      fetchedAt: new Date().toISOString(),
      expiresAt: Date.now() + this.CACHE_DURATION_MS,
    })
  }

  /**
   * Clear all cached prices
   */
  clearCache(): void {
    this.cache.clear()
  }
}
