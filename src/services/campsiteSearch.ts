/**
 * Campsite Search URL Generators
 * Generates deeplinks to external campsite search services with pre-filled context
 */

export type MapBounds = {
  neLat: number
  neLng: number
  swLat: number
  swLng: number
}

/**
 * Extract state abbreviation from an address string
 * Supports formats like:
 * - "City, ST"
 * - "City, State"
 * - "Address, City, ST"
 */
export const extractStateFromAddress = (address: string): string | null => {
  if (!address) {
    return null
  }

  // Common US state abbreviations
  const stateAbbrev = new Set([
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
    'DC', 'AS', 'GU', 'MP', 'PR', 'VI',
  ])

  // Match potential state abbreviations in the address
  const parts = address.split(',').map(part => part.trim())
  
  // Check last or second-to-last part for state abbreviation
  for (let i = parts.length - 1; i >= Math.max(0, parts.length - 2); i--) {
    const part = parts[i].trim()
    // Extract first two characters (state code)
    const potential = part.substring(0, 2).toUpperCase()
    if (stateAbbrev.has(potential)) {
      return potential
    }
  }

  return null
}

/**
 * Generate Free Campsites URL
 * Opens the site with location in URL hash: https://freecampsites.net/#!location
 */

// Hyphenated lowercase state names for RV Life and Campendium URLs
const STATE_ABBREV_TO_NAME: Record<string, string> = {
  'AL': 'alabama', 'AK': 'alaska', 'AZ': 'arizona', 'AR': 'arkansas', 'CA': 'california',
  'CO': 'colorado', 'CT': 'connecticut', 'DE': 'delaware', 'FL': 'florida', 'GA': 'georgia',
  'HI': 'hawaii', 'ID': 'idaho', 'IL': 'illinois', 'IN': 'indiana', 'IA': 'iowa',
  'KS': 'kansas', 'KY': 'kentucky', 'LA': 'louisiana', 'ME': 'maine', 'MD': 'maryland',
  'MA': 'massachusetts', 'MI': 'michigan', 'MN': 'minnesota', 'MS': 'mississippi', 'MO': 'missouri',
  'MT': 'montana', 'NE': 'nebraska', 'NV': 'nevada', 'NH': 'new-hampshire', 'NJ': 'new-jersey',
  'NM': 'new-mexico', 'NY': 'new-york', 'NC': 'north-carolina', 'ND': 'north-dakota', 'OH': 'ohio',
  'OK': 'oklahoma', 'OR': 'oregon', 'PA': 'pennsylvania', 'RI': 'rhode-island', 'SC': 'south-carolina',
  'SD': 'south-dakota', 'TN': 'tennessee', 'TX': 'texas', 'UT': 'utah', 'VT': 'vermont',
  'VA': 'virginia', 'WA': 'washington', 'WV': 'west-virginia', 'WI': 'wisconsin', 'WY': 'wyoming',
  'DC': 'washington-dc', 'AS': 'american-samoa', 'GU': 'guam', 'MP': 'northern-mariana-islands',
  'PR': 'puerto-rico', 'VI': 'virgin-islands',
}

// Properly capitalized state names for Free Campsites URLs
const STATE_ABBREV_TO_FULL_NAME: Record<string, string> = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
  'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia',
  'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
  'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
  'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi', 'MO': 'Missouri',
  'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey',
  'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
  'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
  'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont',
  'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming',
  'DC': 'Washington DC', 'AS': 'American Samoa', 'GU': 'Guam', 'MP': 'Northern Mariana Islands',
  'PR': 'Puerto Rico', 'VI': 'Virgin Islands',
}

/**
 * Capitalize first letter of each word in a string
 */
const capitalizeWords = (str: string): string => {
  return str.split(' ').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(' ')
}

export const generateFreeCampsitesUrl = (address?: string): string => {
  const baseUrl = 'https://freecampsites.net/'
  
  if (!address) {
    return baseUrl
  }

  // Parse address and extract only city and state (skip street address, zip, and country)
  // Address format from geocoder/autocomplete: "Street Address, City, State ZipCode, Country"
  const parts = address.split(',').map(part => part.trim())
  
  // Filter out USA and empty parts
  const filtered = parts.filter(part => part.toUpperCase() !== 'USA' && part.length > 0)
  
  // If we have a street address as the first part, skip it
  // (street addresses typically contain numbers and are longer than just a city name)
  let startIndex = 0
  if (filtered.length > 2 && /\d/.test(filtered[0])) {
    startIndex = 1 // Skip street address
  }
  
  // Extract city and state+zip parts
  const cityRaw = filtered[startIndex] || ''
  const stateAndZip = filtered[startIndex + 1] || ''
  
  // Extract state abbreviation from "GA 28110" or "GA" format
  const stateMatch = stateAndZip.match(/([A-Z]{2})(?:\s+\d+)?/)
  const stateAbbrev = stateMatch?.[1]
  
  if (!cityRaw || !stateAbbrev) {
    return baseUrl
  }
  
  // Capitalize city name properly (e.g., "woodbine" -> "Woodbine")
  const city = capitalizeWords(cityRaw)
  
  // Convert state abbreviation to full capitalized name (e.g., "GA" -> "Georgia")
  const stateName = STATE_ABBREV_TO_FULL_NAME[stateAbbrev]
  
  if (!stateName) {
    return baseUrl
  }
  
  // Format: City,+State (e.g., "Woodbine,+Georgia")
  const searchTerm = `${city},+${stateName}`
  
  return `${baseUrl}#!${searchTerm}`
}

/**
 * Generate RV Life Campgrounds URL
 * Opens regional search based on state from address
 * Format: https://campgrounds.rvlife.com/regions/{state-name}
 */
export const generateRVLifeUrl = (address?: string): string => {
  if (!address) {
    return 'https://campgrounds.rvlife.com/'
  }

  const state = extractStateFromAddress(address)
  if (!state) {
    return 'https://campgrounds.rvlife.com/'
  }

  // Convert state abbreviation to full state name for URL
  const stateName = STATE_ABBREV_TO_NAME[state] || state.toLowerCase()
  return `https://campgrounds.rvlife.com/regions/${stateName}`
}

/**
 * Generate Hipcamp search URL with map bounds
 * Prioritizes stop location if available, falls back to map viewport bounds
 * Format: https://www.hipcamp.com/en-US/search?neLat=...&neLng=...&swLat=...&swLng=...&mapLayers=...
 */
export const generateHipcampUrl = (
  location?: { lat: number; lng: number } | null,
  bounds?: MapBounds,
  address?: string
): string => {
  const baseUrl = 'https://www.hipcamp.com/en-US/search?'
  const params = new URLSearchParams()

  // If stop location is available, generate bounds around it
  if (location) {
    // Create a search radius of ~0.5 degrees (~34-55 miles depending on latitude)
    const radius = 0.5
    const neLat = location.lat + radius
    const neLng = location.lng + radius
    const swLat = location.lat - radius
    const swLng = location.lng - radius

    params.append('neLat', neLat.toString())
    params.append('neLng', neLng.toString())
    params.append('swLat', swLat.toString())
    params.append('swLng', swLng.toString())
    params.append('searchSource', 'map-pan')
  } else if (bounds) {
    // Fall back to map viewport bounds
    params.append('neLat', bounds.neLat.toString())
    params.append('neLng', bounds.neLng.toString())
    params.append('swLat', bounds.swLat.toString())
    params.append('swLng', bounds.swLng.toString())
    params.append('searchSource', 'map-pan')
  } else if (address) {
    // If no location or bounds, just open with base search
    try {
      navigator.clipboard.writeText(address).catch(() => {
        // Silent fail
      })
    } catch {
      // Silent fail
    }
  }

  // Add map layers to show all campground types
  params.append('mapLayers', 'nationalParkSystem')
  params.append('mapLayers', 'nationalForests')
  params.append('mapLayers', 'publicCampgrounds')
  if (!location && !bounds) {
    params.append('q', 'Map area')
  }

  return baseUrl + params.toString()
}

/**
 * Generate Campendium search URL
 * Opens region/city search based on address
 * Format: https://www.campendium.com/{state-name}/{city}
 */
export const generateCampendiumUrl = (address?: string): string => {
  const baseUrl = 'https://www.campendium.com/'
  
  if (!address) {
    return baseUrl
  }

  // Parse address and extract city and state
  // Address format from geocoder/autocomplete: "Street Address, City, State ZipCode, Country"
  const parts = address.split(',').map(part => part.trim())
  
  // Filter out USA and empty parts
  const filtered = parts.filter(part => part.toUpperCase() !== 'USA' && part.length > 0)
  
  // If we have a street address as the first part, skip it
  let startIndex = 0
  if (filtered.length > 2 && /\d/.test(filtered[0])) {
    startIndex = 1 // Skip street address
  }
  
  // Extract city
  const city = filtered[startIndex]?.toLowerCase().replace(/\s+/g, '-') || ''
  
  // Extract state abbreviation from "NC 28110" or "NC" format
  const stateAndZip = filtered[startIndex + 1] || ''
  // Try to match state abbreviation with optional zip code
  const stateMatch = stateAndZip.match(/^([A-Z]{2})(?:\s+\d+)?$/)
  const stateAbbrev = stateMatch?.[1] || stateAndZip.toUpperCase().substring(0, 2)
  
  // Convert state abbreviation to full name
  const stateName = STATE_ABBREV_TO_NAME[stateAbbrev] || stateAndZip.toLowerCase()
  
  // Format URL (e.g., "https://www.campendium.com/north-carolina/monroe")
  if (city && stateName) {
    return `${baseUrl}${stateName}/${city}`
  } else if (stateName) {
    return `${baseUrl}${stateName}`
  }
  
  return baseUrl
}

/**
 * Generate RV Parky search URL
 * Opens search with location name and coordinates
 * Format: https://www.rvparky.com/search?l=Location&x=lat&y=lng
 */
export const generateRVParkyUrl = (
  address?: string,
  location?: { lat: number; lng: number } | null
): string => {
  const baseUrl = 'https://www.rvparky.com/search?'
  
  if (!address) {
    return 'https://www.rvparky.com/'
  }

  const params = new URLSearchParams()
  
  // Parse address to extract city and state (skip street address and zip)
  const parts = address.split(',').map(part => part.trim())
  const filtered = parts.filter(part => part.toUpperCase() !== 'USA' && part.length > 0)
  
  // Skip street address if present
  let startIndex = 0
  if (filtered.length > 2 && /\d/.test(filtered[0])) {
    startIndex = 1
  }
  
  // Extract city and state parts
  const city = filtered[startIndex] || ''
  const stateAndZip = filtered[startIndex + 1] || ''
  
  // Extract state abbreviation (without zip code)
  const stateMatch = stateAndZip.match(/^([A-Z]{2})(?:\s+\d+)?$/)
  const state = stateMatch?.[1] || stateAndZip.split(' ')[0]
  
  // Build location parameter (e.g., "Monroe, NC")
  const locationParam = [city, state].filter(Boolean).join(', ')
  params.append('l', locationParam)
  
  // Add coordinates if available
  if (location) {
    params.append('x', location.lat.toString())
    params.append('y', location.lng.toString())
  }
  
  return baseUrl + params.toString()
}

/**
 * Open external link in new tab with best practices
 */
export const openExternalLink = (url: string, target = '_blank'): void => {
  window.open(url, target, 'noopener,noreferrer')
}
