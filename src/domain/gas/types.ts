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
