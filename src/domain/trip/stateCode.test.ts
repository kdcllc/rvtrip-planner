import { describe, expect, it } from 'vitest'
import { extractUsStateCode, getTripStartState } from './stateCode'

describe('extractUsStateCode', () => {
  it.each([
    ['2000 Riverside Dr, Monroe, LA 71201, USA', 'LA'],
    ['3412 Askew Ferry Rd, Edwards, MS 39066, USA', 'MS'],
    ['Bristol, VA 24202-1234, USA', 'VA'],
  ])('T1 code with ZIP: %s -> %s', (address, expected) => {
    expect(extractUsStateCode(address)).toBe(expected)
  })

  it.each([
    ['Sugar Hollow Drive, Bristol, Virginia, 24202, United States', 'VA'],
    ['Cumberland Mountain State Park, Crossville, Tennessee, United States', 'TN'],
    [
      '501, Harahan Boulevard, Paducah, McCracken County, Kentucky, 42001, United States',
      'KY',
    ],
  ])('T2 full state name: %s -> %s', (address, expected) => {
    expect(extractUsStateCode(address)).toBe(expected)
  })

  it.each([
    ['Kansas City, Missouri, 64101, United States', 'MO'],
    ['New York, New York, 10001, United States', 'NY'],
    ['Washington, District of Columbia, 20001, United States', 'DC'],
    ['1 West Virginia Avenue, Richmond, Virginia, United States', 'VA'],
    ['Charleston, West Virginia, United States', 'WV'],
  ])('T3 ambiguous names resolve from the end: %s -> %s', (address, expected) => {
    expect(extractUsStateCode(address)).toBe(expected)
  })

  it.each([
    ['bristol, virginia, united states', 'VA'],
    ['Santa Fe,  New   Mexico , USA', 'NM'],
    ['Bristol, Virginia 24202, USA', 'VA'],
  ])('T4 case and spacing: %s -> %s', (address, expected) => {
    expect(extractUsStateCode(address)).toBe(expected)
  })

  it.each([
    [''],
    ['   '],
    ['Toronto, Ontario, Canada'],
    ['12 Main Dr, Springfield, USA'],
    ['Somewhere, US'],
    ['24202'],
  ])('T5 no state: %j -> null', (address) => {
    expect(extractUsStateCode(address)).toBeNull()
  })

  it('T6 lower-case two-letter text is not a code', () => {
    expect(extractUsStateCode('Paris, la 71201, USA')).toBeNull()
  })
})

describe('getTripStartState', () => {
  const located = { lat: 1, lng: 2 }

  it('T7 returns the first stop state when it has a location', () => {
    expect(
      getTripStartState([
        { address: 'Bristol, VA 24202, USA', location: located },
        { address: 'Monroe, LA 71201, USA', location: located },
      ]),
    ).toBe('VA')
  })

  it('T7 skips a first stop without a location', () => {
    expect(
      getTripStartState([
        { address: 'Bristol, VA 24202, USA' },
        { address: 'Monroe, LA 71201, USA', location: located },
      ]),
    ).toBe('LA')
  })

  it('T7 skips a first stop whose address has no state', () => {
    expect(
      getTripStartState([
        { address: 'Somewhere, USA', location: located },
        { address: 'Monroe, LA 71201, USA', location: located },
      ]),
    ).toBe('LA')
  })

  it('T7 returns null for an empty array', () => {
    expect(getTripStartState([])).toBeNull()
  })

  it('T7 returns null when no stop qualifies', () => {
    expect(
      getTripStartState([
        { address: 'Bristol, VA 24202, USA' },
        { address: 'Somewhere, USA', location: located },
      ]),
    ).toBeNull()
  })
})
