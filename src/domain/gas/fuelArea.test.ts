import { describe, expect, it } from 'vitest'
import { EIA_AREAS, EIA_NATIONAL_AREA, EIA_PRODUCT_BY_FUEL, getEiaAreaForState } from './fuelArea'

const ALL_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC',
  'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
]

describe('getEiaAreaForState', () => {
  it('has 51 codes in the fixture', () => {
    expect(new Set(ALL_CODES).size).toBe(51)
  })

  it.each([
    ['CA', 'SCA'], ['CO', 'SCO'], ['FL', 'SFL'], ['MA', 'SMA'], ['MN', 'SMN'],
    ['NY', 'SNY'], ['OH', 'SOH'], ['TX', 'STX'], ['WA', 'SWA'],
  ])('maps %s to its state series %s', (state, area) => {
    expect(getEiaAreaForState(state)).toBe(area)
  })

  it.each([
    ['CT', 'R1X'], ['PA', 'R1Y'], ['VA', 'R1Z'], ['IL', 'R20'], ['LA', 'R30'], ['MT', 'R40'], ['NV', 'R5XCA'],
  ])('maps %s to PADD area %s', (state, area) => {
    expect(getEiaAreaForState(state)).toBe(area)
  })

  it('falls back to the national area', () => {
    expect(getEiaAreaForState(null)).toBe('NUS')
    expect(getEiaAreaForState('')).toBe('NUS')
    expect(getEiaAreaForState('ZZ')).toBe('NUS')
    expect(EIA_NATIONAL_AREA).toBe('NUS')
  })

  it('trims and upper-cases input', () => {
    expect(getEiaAreaForState(' va ')).toBe('R1Z')
  })

  it('only returns areas listed in EIA_AREAS', () => {
    for (const code of ALL_CODES) {
      expect(EIA_AREAS).toContain(getEiaAreaForState(code))
      expect(EIA_AREAS).toContain(getEiaAreaForState(code, 'diesel'))
    }
    expect(EIA_AREAS).toContain('NUS')
  })

  it('uses PADD areas for diesel except California', () => {
    expect(getEiaAreaForState('CA', 'diesel')).toBe('SCA')
    expect(getEiaAreaForState('TX', 'diesel')).toBe('R30')
    expect(getEiaAreaForState('NY', 'diesel')).toBe('R1Y')
    expect(getEiaAreaForState('WA', 'diesel')).toBe('R5XCA')
    expect(getEiaAreaForState('CO', 'diesel')).toBe('R40')
    expect(getEiaAreaForState('FL', 'diesel')).toBe('R1Z')
    expect(getEiaAreaForState('MA', 'diesel')).toBe('R1X')
    expect(getEiaAreaForState('MN', 'diesel')).toBe('R20')
    expect(getEiaAreaForState('OH', 'diesel')).toBe('R20')
  })

  it('defaults to gasoline', () => {
    expect(getEiaAreaForState('TX')).toBe('STX')
  })
})

describe('EIA_PRODUCT_BY_FUEL', () => {
  it('maps fuel types to EIA product codes', () => {
    expect(EIA_PRODUCT_BY_FUEL).toEqual({ gasoline: 'EPMR', diesel: 'EPD2D' })
  })
})
