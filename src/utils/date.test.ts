import { describe, expect, it } from 'vitest'
import type { TripStop } from '../domain/trip/types'
import { getRelevantStopForDate, getRelevantStopIdForDate } from './date'

const buildStop = (overrides: Partial<TripStop>): TripStop => ({
  id: overrides.id ?? 'stop-id',
  label: overrides.label ?? 'Stop',
  address: overrides.address ?? '123 Test St',
  startDate: overrides.startDate ?? '',
  endDate: overrides.endDate ?? '',
  ...overrides,
})

describe('date utils relevant stop selection', () => {
  it('returns the stop that includes the reference date', () => {
    const stops = [
      buildStop({ id: 'start', label: 'Starting point', startDate: '2026-03-01', endDate: '2026-03-01' }),
      buildStop({ id: 'current', label: 'Current stop', startDate: '2026-03-14', endDate: '2026-03-16' }),
      buildStop({ id: 'next', label: 'Next stop', startDate: '2026-03-18', endDate: '2026-03-19' }),
    ]

    expect(getRelevantStopIdForDate(stops, new Date('2026-03-15T12:00:00'))).toBe('current')
  })

  it('returns the next upcoming stop when today is before the trip', () => {
    const stops = [
      buildStop({ id: 'later', startDate: '2026-03-20', endDate: '2026-03-21' }),
      buildStop({ id: 'soonest', startDate: '2026-03-16', endDate: '2026-03-17' }),
    ]

    expect(getRelevantStopIdForDate(stops, new Date('2026-03-15T08:00:00'))).toBe('soonest')
  })

  it('returns the last dated stop when the trip is complete', () => {
    const stops = [
      buildStop({ id: 'first', startDate: '2026-03-01', endDate: '2026-03-02' }),
      buildStop({ id: 'last', startDate: '2026-03-10', endDate: '2026-03-12' }),
    ]

    expect(getRelevantStopIdForDate(stops, new Date('2026-03-15T09:00:00'))).toBe('last')
  })

  it('ignores undated stops when dated stops exist', () => {
    const stops = [
      buildStop({ id: 'manual', label: 'Manual stop' }),
      buildStop({ id: 'dated', startDate: '2026-03-16', endDate: '2026-03-17', manualEntry: true }),
    ]

    expect(getRelevantStopIdForDate(stops, new Date('2026-03-15T09:00:00'))).toBe('dated')
  })

  it('returns null when no stops have dates', () => {
    const stops = [buildStop({ id: 'manual-only' })]

    expect(getRelevantStopForDate(stops, new Date('2026-03-15T09:00:00'))).toBeNull()
  })

  it('treats same-day stops as active on that calendar day', () => {
    const stop = buildStop({ id: 'same-day', startDate: '2026-03-15', endDate: '2026-03-15' })

    expect(getRelevantStopIdForDate([stop], new Date('2026-03-15T23:30:00'))).toBe('same-day')
  })
})