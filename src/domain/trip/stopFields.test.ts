import { describe, expect, it } from 'vitest'
import {
  STOP_NOTE_MAX_LENGTH,
  deriveStopLabel,
  foldLegacyStopFields,
  hasStopDates,
  type LegacyTripStop,
} from './stopFields'

const stop = (over: Partial<LegacyTripStop> = {}): LegacyTripStop => ({
  id: 's1',
  label: 'Camp',
  address: '1 Main St, Town',
  startDate: '2025-06-01',
  endDate: '2025-06-02',
  ...over,
})

describe('STOP_NOTE_MAX_LENGTH', () => {
  it('is 2000', () => expect(STOP_NOTE_MAX_LENGTH).toBe(2000))
})

describe('foldLegacyStopFields', () => {
  it('returns the same reference when there is nothing to fold', () => {
    const s = stop({ note: 'hi', source: { name: 'Hipcamp', url: 'u' } })
    expect(foldLegacyStopFields(s)).toBe(s)
  })

  it('appends fees, amenities, reservation after existing note in order', () => {
    const r = foldLegacyStopFields(
      stop({
        note: 'Base',
        reservationNote: 'Call ahead',
        source: { name: 'Other', fees: '$35, membership', amenities: 'Wifi' },
      }),
    )
    expect(r.note).toBe(
      'Base\nFees: $35, membership\nAmenities: Wifi\nReservation: Call ahead',
    )
  })

  it('omits legacy keys from the result', () => {
    const r = foldLegacyStopFields(
      stop({ reservationNote: 'x', source: { name: 'Other', fees: 'a', amenities: 'b' } }),
    )
    expect('reservationNote' in r).toBe(false)
    expect(r.source).toEqual({ name: 'Other' })
    expect('fees' in r.source!).toBe(false)
    expect('amenities' in r.source!).toBe(false)
  })

  it('ignores blank or whitespace legacy values but still strips the keys', () => {
    const r = foldLegacyStopFields(
      stop({ reservationNote: '  ', source: { name: 'Other', fees: '', amenities: ' \n' } }),
    )
    expect(r.note).toBeUndefined()
    expect('reservationNote' in r).toBe(false)
    expect(r.source).toEqual({ name: 'Other' })
  })

  it('strips an explicit undefined reservationNote key', () => {
    const r = foldLegacyStopFields(stop({ reservationNote: undefined }))
    expect('reservationNote' in r).toBe(false)
  })

  it('preserves other source keys', () => {
    const r = foldLegacyStopFields(
      stop({ source: { name: 'Hipcamp', url: 'u', siteType: 'tent', fees: 'x' } }),
    )
    expect(r.source).toEqual({ name: 'Hipcamp', url: 'u', siteType: 'tent' })
  })

  it.each([
    ['$45', 45],
    ['45', 45],
    ['35.50', 35.5],
    ['$35/night', 35],
    ['$35 per night', 35],
    ['$35 PER NIGHT', 35],
    ['  $12  ', 12],
  ])('turns price-only fees %j into nightlyCost %d', (fees, cost) => {
    const r = foldLegacyStopFields(stop({ source: { name: 'Other', fees } }))
    expect(r.nightlyCost).toBe(cost)
    expect(r.note).toBeUndefined()
  })

  it('keeps fees text when it has more than a price', () => {
    const r = foldLegacyStopFields(
      stop({ source: { name: 'Other', fees: '$35/night, membership required' } }),
    )
    expect(r.nightlyCost).toBeUndefined()
    expect(r.note).toBe('Fees: $35/night, membership required')
  })

  it('keeps existing nightlyCost and adds a Fees line', () => {
    const r = foldLegacyStopFields(
      stop({ nightlyCost: 20, source: { name: 'Other', fees: '$45' } }),
    )
    expect(r.nightlyCost).toBe(20)
    expect(r.note).toBe('Fees: $45')
  })

  it('never truncates the folded note', () => {
    const long = 'x'.repeat(STOP_NOTE_MAX_LENGTH + 500)
    const r = foldLegacyStopFields(stop({ note: long, reservationNote: 'r' }))
    expect(r.note).toBe(`${long}\nReservation: r`)
    expect(r.note!.length).toBeGreaterThan(STOP_NOTE_MAX_LENGTH)
  })

  it('is idempotent', () => {
    const once = foldLegacyStopFields(
      stop({ note: 'n', reservationNote: 'r', source: { name: 'Other', fees: 'a b', amenities: 'c' } }),
    )
    const twice = foldLegacyStopFields(once)
    expect(twice).toEqual(once)
    expect(twice).toBe(once)
  })

  it('does not mutate the input', () => {
    const s = stop({ note: 'n', reservationNote: 'r', source: { name: 'Other', fees: '$9', amenities: 'c' } })
    const copy = structuredClone(s)
    foldLegacyStopFields(s)
    expect(s).toEqual(copy)
  })
})

describe('deriveStopLabel', () => {
  it('takes text before the first comma, trimmed', () => {
    expect(deriveStopLabel('  Yosemite Valley , CA, USA')).toBe('Yosemite Valley')
  })
  it('returns the trimmed string when no comma', () => {
    expect(deriveStopLabel('  Reno  ')).toBe('Reno')
  })
  it('returns empty for blank', () => {
    expect(deriveStopLabel('   ')).toBe('')
    expect(deriveStopLabel('')).toBe('')
  })
})

describe('hasStopDates', () => {
  it('is true only when both dates are non-empty', () => {
    expect(hasStopDates({ startDate: 'a', endDate: 'b' })).toBe(true)
    expect(hasStopDates({ startDate: '', endDate: 'b' })).toBe(false)
    expect(hasStopDates({ startDate: 'a', endDate: '' })).toBe(false)
    expect(hasStopDates({ startDate: '', endDate: '' })).toBe(false)
  })
})
