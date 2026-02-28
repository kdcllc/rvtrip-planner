const TRUCK_MAP_BASE_URL = 'https://truckmap.com/place'

function toSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeState(value: string): string | undefined {
  const compact = value.trim()
  if (!compact) {
    return undefined
  }

  const stateCodeMatch = compact.match(/\b([A-Za-z]{2})\b/)
  if (stateCodeMatch) {
    return stateCodeMatch[1].toLowerCase()
  }

  const slug = toSlug(compact)
  return slug || undefined
}

function normalizeCountry(value: string): string | undefined {
  const slug = toSlug(value)
  if (!slug) {
    return undefined
  }

  if (slug === 'us' || slug === 'u-s' || slug === 'u-s-a' || slug === 'united-states') {
    return 'usa'
  }

  if (slug === 'usa') {
    return 'usa'
  }

  if (slug === 'canada' || slug === 'mexico') {
    return slug
  }

  return undefined
}

function getAddressSegments(address: string): string[] {
  return address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

export function buildTruckMapPlaceUrl(address: string): string | undefined {
  const segments = getAddressSegments(address)
  if (segments.length < 2) {
    return undefined
  }

  const lastSegment = segments[segments.length - 1]
  let country = normalizeCountry(lastSegment)
  const withoutCountry = country ? segments.slice(0, -1) : [...segments]

  if (withoutCountry.length < 2) {
    return undefined
  }

  const state = normalizeState(withoutCountry[withoutCountry.length - 1])
  const city = toSlug(withoutCountry[withoutCountry.length - 2])

  if (!city || !state) {
    return undefined
  }

  if (!country && /^[a-z]{2}$/.test(state)) {
    country = 'usa'
  }

  if (!country) {
    return undefined
  }

  return `${TRUCK_MAP_BASE_URL}/${city}-${state}-${country}/`
}
