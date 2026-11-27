import type { TripStop } from './types'

const STATE_CODES_BY_NAME: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
}

const VALID_STATE_CODES = new Set(Object.values(STATE_CODES_BY_NAME))

const CODE_PART = /^([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/
const NAME_WITH_ZIP = /^(.*?)(?:\s+\d{5}(?:-\d{4})?)?$/

function stateFromPart(part: string): string | null {
  const codeMatch = CODE_PART.exec(part)
  if (codeMatch && VALID_STATE_CODES.has(codeMatch[1])) return codeMatch[1]

  const collapsed = part.replace(/\s+/g, ' ')
  const nameMatch = NAME_WITH_ZIP.exec(collapsed)
  const name = (nameMatch ? nameMatch[1] : collapsed).toLowerCase()
  return STATE_CODES_BY_NAME[name] ?? null
}

/** Finds a US state code in a comma-separated address, scanning from the end. */
export function extractUsStateCode(address: string): string | null {
  if (!address.trim()) return null

  const parts = address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  for (let i = parts.length - 1; i >= 0; i--) {
    const code = stateFromPart(parts[i])
    if (code) return code
  }
  return null
}

/** State of the first located stop whose address yields one. */
export function getTripStartState(
  stops: ReadonlyArray<Pick<TripStop, 'address' | 'location'>>,
): string | null {
  for (const stop of stops) {
    if (!stop.location) continue
    const code = extractUsStateCode(stop.address)
    if (code) return code
  }
  return null
}
