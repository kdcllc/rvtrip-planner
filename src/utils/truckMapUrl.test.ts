import { describe, expect, it } from 'vitest'
import { buildTruckMapPlaceUrl } from './truckMapUrl'

describe('buildTruckMapPlaceUrl', () => {
  describe('valid address formats', () => {
    it('builds a TruckMap URL from city, state, country', () => {
      const result = buildTruckMapPlaceUrl('Monroe, NC, USA')

      expect(result).toBe('https://truckmap.com/place/monroe-nc-usa/')
    })

    it('supports street-style addresses by using city and state segments', () => {
      const result = buildTruckMapPlaceUrl('123 Main St, Monroe, NC 28110, USA')

      expect(result).toBe('https://truckmap.com/place/monroe-nc-usa/')
    })

    it('normalizes case and punctuation', () => {
      const result = buildTruckMapPlaceUrl('  St. Louis  , Mo , United States  ')

      expect(result).toBe('https://truckmap.com/place/st-louis-mo-usa/')
    })

    it('defaults country to usa when only state code is present', () => {
      const result = buildTruckMapPlaceUrl('Monroe, NC')

      expect(result).toBe('https://truckmap.com/place/monroe-nc-usa/')
    })

    it('handles full state names', () => {
      const result = buildTruckMapPlaceUrl('Denver, Colorado, USA')

      expect(result).toBe('https://truckmap.com/place/denver-colorado-usa/')
    })

    it('handles cities with multiple words', () => {
      const result = buildTruckMapPlaceUrl('San Francisco, CA, USA')

      expect(result).toBe('https://truckmap.com/place/san-francisco-ca-usa/')
    })

    it('handles cities with special characters', () => {
      const result = buildTruckMapPlaceUrl("O'Fallon, MO, USA")

      expect(result).toBe('https://truckmap.com/place/o-fallon-mo-usa/')
    })

    it('handles addresses with zip codes', () => {
      const result = buildTruckMapPlaceUrl('Atlanta, GA 30301, USA')

      expect(result).toBe('https://truckmap.com/place/atlanta-ga-usa/')
    })

    it('handles Canada addresses', () => {
      const result = buildTruckMapPlaceUrl('Toronto, ON, Canada')

      expect(result).toBe('https://truckmap.com/place/toronto-on-canada/')
    })

    it('handles Mexico addresses', () => {
      const result = buildTruckMapPlaceUrl('Tijuana, BC, Mexico')

      expect(result).toBe('https://truckmap.com/place/tijuana-bc-mexico/')
    })

    it('handles addresses with county information', () => {
      const result = buildTruckMapPlaceUrl('Portland, Multnomah County, OR, USA')

      expect(result).toBe('https://truckmap.com/place/multnomah-county-or-usa/')
    })
  })

  describe('invalid address formats', () => {
    it('returns undefined when address is incomplete', () => {
      const result = buildTruckMapPlaceUrl('Monroe')

      expect(result).toBeUndefined()
    })

    it('returns undefined when city or state cannot be parsed', () => {
      const result = buildTruckMapPlaceUrl(',, ,')

      expect(result).toBeUndefined()
    })

    it('returns undefined for empty string', () => {
      const result = buildTruckMapPlaceUrl('')

      expect(result).toBeUndefined()
    })

    it('returns undefined when only city is provided', () => {
      const result = buildTruckMapPlaceUrl('Monroe,')

      expect(result).toBeUndefined()
    })

    it('returns undefined for unknown country formats', () => {
      const result = buildTruckMapPlaceUrl('London, England, United Kingdom')

      expect(result).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    it('handles addresses with extra whitespace', () => {
      const result = buildTruckMapPlaceUrl('  Monroe  ,  NC  ,  USA  ')

      expect(result).toBe('https://truckmap.com/place/monroe-nc-usa/')
    })

    it('handles addresses with multiple commas', () => {
      const result = buildTruckMapPlaceUrl('123 Main St,, Monroe,, NC, USA')

      expect(result).toBe('https://truckmap.com/place/monroe-nc-usa/')
    })

    it('handles lowercase input', () => {
      const result = buildTruckMapPlaceUrl('monroe, nc, usa')

      expect(result).toBe('https://truckmap.com/place/monroe-nc-usa/')
    })

    it('handles uppercase input', () => {
      const result = buildTruckMapPlaceUrl('MONROE, NC, USA')

      expect(result).toBe('https://truckmap.com/place/monroe-nc-usa/')
    })

    it('handles mixed case with punctuation', () => {
      const result = buildTruckMapPlaceUrl('St. Paul\'s, MN, U.S.A.')

      expect(result).toBe('https://truckmap.com/place/st-paul-s-mn-usa/')
    })

    it('removes consecutive hyphens from slugs', () => {
      const result = buildTruckMapPlaceUrl('City--Name, NC, USA')

      expect(result).toBe('https://truckmap.com/place/city-name-nc-usa/')
    })

    it('handles numeric characters in city names', () => {
      const result = buildTruckMapPlaceUrl('29 Palms, CA, USA')

      expect(result).toBe('https://truckmap.com/place/29-palms-ca-usa/')
    })
  })

  describe('real-world address examples', () => {
    it('handles typical autocomplete address format', () => {
      const result = buildTruckMapPlaceUrl('Asheville, NC, USA')

      expect(result).toBe('https://truckmap.com/place/asheville-nc-usa/')
    })

    it('handles RV park addresses with street info', () => {
      const result = buildTruckMapPlaceUrl('1234 Campground Rd, Gatlinburg, TN 37738, USA')

      expect(result).toBe('https://truckmap.com/place/gatlinburg-tn-usa/')
    })

    it('handles rest area addresses', () => {
      const result = buildTruckMapPlaceUrl('I-40 Rest Area, Amarillo, TX, USA')

      expect(result).toBe('https://truckmap.com/place/amarillo-tx-usa/')
    })

    it('handles truck stop addresses', () => {
      const result = buildTruckMapPlaceUrl("Love's Travel Stop, Kingman, AZ, USA")

      expect(result).toBe('https://truckmap.com/place/kingman-az-usa/')
    })
  })
})
