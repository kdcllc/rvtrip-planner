/**
 * Site types that typically have check-in and check-out time requirements
 */
const SITE_TYPES_WITH_CHECKIN: Set<string> = new Set([
  'RV Park',
  'Campground',
  'RV Resort',
  'Hotel/Motel',
  'Harvest Host',
  'Cabin Rental',
  'Airbnb/VRBO',
  'Resort',
  'Farm Stay',
  'Winery',
  'Marina',
  'Glamping',
  'Dude Ranch',
  'Hostel',
])

/**
 * Determines if a site type typically requires check-in and check-out times
 * @param siteType - The site type to check
 * @returns true if the site type typically has check-in/out requirements
 */
export function requiresCheckInOut(siteType: string | undefined): boolean {
  if (!siteType) {
    return false
  }
  return SITE_TYPES_WITH_CHECKIN.has(siteType)
}
