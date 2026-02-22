import type { IGasPriceAdapter, GasPriceLookupResult } from '../../domain/gas/types'

/**
 * Hardcoded state-average gas prices (updated periodically)
 * These represent typical state averages and serve as fallback
 * Data last updated: Feb 2026
 */
const STATE_GAS_PRICES: Record<string, number> = {
  AL: 3.12,
  AK: 3.55,
  AZ: 3.28,
  AR: 2.98,
  CA: 4.15,
  CO: 3.18,
  CT: 3.42,
  DE: 3.32,
  FL: 3.22,
  GA: 3.18,
  HI: 4.25,
  ID: 3.18,
  IL: 3.12,
  IN: 3.08,
  IA: 3.08,
  KS: 3.15,
  KY: 3.12,
  LA: 3.15,
  ME: 3.32,
  MD: 3.35,
  MA: 3.42,
  MI: 3.18,
  MN: 3.22,
  MS: 3.08,
  MO: 3.15,
  MT: 3.22,
  NE: 3.12,
  NV: 3.42,
  NH: 3.38,
  NJ: 3.32,
  NM: 3.18,
  NY: 3.48,
  NC: 3.18,
  ND: 3.18,
  OH: 3.12,
  OK: 3.08,
  OR: 3.52,
  PA: 3.32,
  RI: 3.42,
  SC: 3.22,
  SD: 3.18,
  TN: 3.12,
  TX: 3.02,
  UT: 3.22,
  VT: 3.42,
  VA: 3.22,
  WA: 3.65,
  WV: 3.18,
  WI: 3.18,
  WY: 3.18,
}

/**
 * Hardcoded gas price adapter - returns static state averages
 * Provides instant fallback when APIs are unavailable
 */
export class HardcodedGasPriceAdapter implements IGasPriceAdapter {
  name = 'Hardcoded Fallback'

  async getPriceForState(state: string): Promise<GasPriceLookupResult> {
    const stateCode = state.toUpperCase().slice(0, 2)
    const price = STATE_GAS_PRICES[stateCode]

    if (!price) {
      return {
        state: stateCode,
        pricePerGallon: 3.20, // National average fallback
        source: 'Hardcoded Fallback (National Average)',
        fetchedAt: new Date().toISOString(),
        error: `Unknown state: ${state}`,
      }
    }

    return {
      state: stateCode,
      pricePerGallon: price,
      source: 'Hardcoded Fallback',
      fetchedAt: new Date().toISOString(),
    }
  }
}
