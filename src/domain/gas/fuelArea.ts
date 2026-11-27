import type { FuelType } from './types'

export const EIA_PRODUCT_BY_FUEL: Record<FuelType, string> = { gasoline: 'EPMR', diesel: 'EPD2D' }

export const EIA_NATIONAL_AREA = 'NUS'

const STATE_SERIES: Record<string, string> = {
  CA: 'SCA', CO: 'SCO', FL: 'SFL', MA: 'SMA', MN: 'SMN', NY: 'SNY', OH: 'SOH', TX: 'STX', WA: 'SWA',
}

// EIA publishes a weekly state diesel series only for California.
const DIESEL_STATE_SERIES: Record<string, string> = { CA: 'SCA' }

const PADD_AREAS: Record<string, string[]> = {
  R1X: ['CT', 'ME', 'NH', 'RI', 'VT'],
  R1Y: ['DE', 'DC', 'MD', 'NJ', 'PA'],
  R1Z: ['GA', 'NC', 'SC', 'VA', 'WV'],
  R20: ['IL', 'IN', 'IA', 'KS', 'KY', 'MI', 'MO', 'NE', 'ND', 'SD', 'OK', 'TN', 'WI'],
  R30: ['AL', 'AR', 'LA', 'MS', 'NM'],
  R40: ['ID', 'MT', 'UT', 'WY'],
  R5XCA: ['AK', 'AZ', 'HI', 'NV', 'OR'],
}

const PADD_BY_STATE: Record<string, string> = {}
for (const [area, states] of Object.entries(PADD_AREAS)) {
  for (const state of states) PADD_BY_STATE[state] = area
}

// States with their own weekly series are not in a PADD list above; their PADD is needed for diesel.
const SERIES_STATE_PADD: Record<string, string> = {
  CO: 'R40', FL: 'R1Z', MA: 'R1X', MN: 'R20', NY: 'R1Y', OH: 'R20', TX: 'R30', WA: 'R5XCA',
}

export const EIA_AREAS: readonly string[] = [
  ...new Set([EIA_NATIONAL_AREA, ...Object.values(STATE_SERIES), ...Object.keys(PADD_AREAS)]),
]

export function getEiaAreaForState(stateCode: string | null, fuelType: FuelType = 'gasoline'): string {
  if (!stateCode) return EIA_NATIONAL_AREA
  const code = stateCode.trim().toUpperCase()
  const series = fuelType === 'diesel' ? DIESEL_STATE_SERIES : STATE_SERIES
  return series[code] ?? SERIES_STATE_PADD[code] ?? PADD_BY_STATE[code] ?? EIA_NATIONAL_AREA
}
