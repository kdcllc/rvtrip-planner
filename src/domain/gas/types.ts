/**
 * Gas price lookup result from any adapter
 */
export type GasPriceLookupResult = {
  state: string
  pricePerGallon: number
  source: string        // e.g., "Free API", "Hardcoded Fallback"
  fetchedAt: string     // ISO timestamp
  error?: string        // Set if lookup failed
}

/**
 * Adapter interface for pluggable gas price sources
 */
export interface IGasPriceAdapter {
  name: string
  getPriceForState(state: string): Promise<GasPriceLookupResult>
}

/**
 * Cost calculation result
 */
export type FuelCostEstimate = {
  distanceMeters: number
  mpg: number
  gasPricePerGallon: number
  estimatedCost: number   // (distanceMeters / 1609.34 / mpg) * gasPricePerGallon
}
