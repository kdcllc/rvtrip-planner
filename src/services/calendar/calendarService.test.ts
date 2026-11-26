import { describe, it, expect } from 'vitest'
import { generateICalendar } from './calendarService'
import type { TripStop } from '../../domain/trip/types'

const stop = (overrides: Partial<TripStop> = {}): TripStop =>
  ({
    id: '1',
    label: 'Camp',
    address: '1 Road',
    startDate: '2024-01-01',
    endDate: '2024-01-03',
    source: { name: 'manual', siteType: 'campground' },
    ...overrides,
  }) as TripStop

describe('generateICalendar', () => {
  it('includes the note in the event description', () => {
    const ics = generateICalendar([stop({ note: 'Bring firewood' })], 'Trip')
    expect(ics).toContain('Bring firewood')
  })

  it('does not emit Fees or Amenities lines', () => {
    const legacy = stop({
      source: { name: 'manual', fees: '$40', amenities: 'wifi' },
    } as Partial<TripStop>)
    const ics = generateICalendar([legacy], 'Trip')
    expect(ics).not.toContain('Fees:')
    expect(ics).not.toContain('Amenities:')
  })

  it('skips undated stops', () => {
    const ics = generateICalendar(
      [stop({ startDate: '', endDate: '' }), stop({ startDate: '2024-01-01', endDate: '' })],
      'Trip',
    )
    expect(ics).not.toContain('BEGIN:VEVENT')
  })
})
