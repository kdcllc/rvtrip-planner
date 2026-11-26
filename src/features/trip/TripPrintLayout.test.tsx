import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TripPrintLayout } from './TripPrintLayout'
import type { TripPrintData } from '../../domain/trip/print'
import type { TripPrintStop } from '../../domain/trip/print'

const renderLayout = (stop: Partial<TripPrintStop>) => {
  const data = {
    tripName: 'Test Trip',
    exportedAt: '2026-11-25T00:00:00Z',
    stops: [{ id: 's1', label: 'Moab', address: 'Moab, UT, USA', ...stop }],
  } as unknown as TripPrintData
  return render(<TripPrintLayout data={data} />)
}

describe('TripPrintLayout reservation block', () => {
  it('prints Reserved without a heading when no details are set', () => {
    renderLayout({ reservationStatus: 'reserved' })
    expect(screen.getByText('Reserved')).toBeInTheDocument()
    expect(screen.queryByText('Reservation Details')).not.toBeInTheDocument()
  })

  it('prints the heading and the number when a confirmation number is set', () => {
    renderLayout({ reservationStatus: 'reserved', confirmationNumber: 'ABC123' })
    expect(screen.getByText('Reservation Details')).toBeInTheDocument()
    expect(screen.getByText(/ABC123/)).toBeInTheDocument()
    expect(screen.queryByText('Reserved')).not.toBeInTheDocument()
  })

  it('prints neither for an unreserved stop', () => {
    renderLayout({ reservationStatus: 'none' as TripPrintStop['reservationStatus'] })
    expect(screen.queryByText('Reserved')).not.toBeInTheDocument()
    expect(screen.queryByText('Reservation Details')).not.toBeInTheDocument()
  })
})
