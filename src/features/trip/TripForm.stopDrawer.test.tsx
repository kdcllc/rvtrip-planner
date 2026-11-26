import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TripStop } from '../../domain/trip/types'
import { deriveStopLabel } from '../../domain/trip/stopFields'

const geocodeAddress = vi.hoisted(() => vi.fn())
const fetchAutocompleteSuggestions = vi.hoisted(() => vi.fn())
vi.mock('../../services/geocoding/geocodingService', () => ({ geocodeAddress }))
vi.mock('../../services/geocoding/autocompleteService', () => ({
  fetchAutocompleteSuggestions,
}))
vi.mock('../../services/campsiteSearch', () => ({
  openExternalLink: vi.fn(),
  extractStateFromAddress: vi.fn(() => null),
}))

import { TripForm } from './TripForm'

const ADDRESS = 'Moab, UT, USA'
const LOCATION = { lat: 38.57, lng: -109.55 }

const renderForm = (stops: TripStop[] = []) => {
  const onAddStop = vi.fn()
  render(
    <TripForm
      stops={stops}
      onAddStop={onAddStop}
      onRemoveStop={vi.fn()}
      onUpdateStop={vi.fn()}
      onReorderStop={vi.fn()}
      selectedStopIds={new Set()}
      onToggleStopSelection={vi.fn()}
      onSelectAllStops={vi.fn()}
      onClearStopSelection={vi.fn()}
    />,
  )
  return { onAddStop }
}

const setup = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

const openDrawer = async (user: ReturnType<typeof setup>) => {
  await user.click(screen.getByRole('button', { name: 'Add stop' }))
}

const typeAddress = async (user: ReturnType<typeof setup>, text = ADDRESS) => {
  await user.type(screen.getByLabelText(/^Address/), text)
}

const clickSave = (user: ReturnType<typeof setup>) =>
  user.click(screen.getByRole('button', { name: 'Add Stop' }))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  geocodeAddress.mockReset()
  fetchAutocompleteSuggestions.mockReset()
  geocodeAddress.mockImplementation(async (address: string) => ({
    address,
    location: LOCATION,
  }))
  fetchAutocompleteSuggestions.mockResolvedValue({ suggestions: [] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TripForm stop drawer: save rules', () => {
  it('saves a stop with only a validated address, deriving the label and leaving dates empty', async () => {
    const user = setup()
    const { onAddStop } = renderForm()
    await openDrawer(user)
    await typeAddress(user)
    await clickSave(user)

    expect(onAddStop).toHaveBeenCalledTimes(1)
    const saved = onAddStop.mock.calls[0][0] as TripStop
    expect(saved.label).toBe(deriveStopLabel(ADDRESS))
    expect(saved.label).toBe('Moab')
    expect(saved.startDate).toBe('')
    expect(saved.endDate).toBe('')
    expect(saved).not.toHaveProperty('reservationNote')
    expect(Object.keys(saved.source ?? {})).not.toContain('fees')
    expect(Object.keys(saved.source ?? {})).not.toContain('amenities')
  })

  it('rejects an empty address with a role=alert error and aria-invalid', async () => {
    const user = setup()
    const { onAddStop } = renderForm()
    await openDrawer(user)
    await clickSave(user)

    expect(onAddStop).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Add an address for this stop.')
    expect(screen.getByLabelText(/^Address/)).toHaveAttribute('aria-invalid', 'true')
  })

  it('rejects arrival after departure with the date-order error', async () => {
    const user = setup()
    const { onAddStop } = renderForm()
    await openDrawer(user)
    await typeAddress(user)
    fireEvent.change(screen.getByLabelText('Arrival'), { target: { value: '2030-06-10' } })
    fireEvent.change(screen.getByLabelText('Departure'), { target: { value: '2030-06-05' } })
    await clickSave(user)

    expect(onAddStop).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Arrival date must be on or before the departure date.',
    )
  })

  it('keeps a user-typed title when an address suggestion is picked afterwards', async () => {
    fetchAutocompleteSuggestions.mockResolvedValue({
      suggestions: [
        {
          id: 's1',
          mainText: 'Arches National Park',
          secondaryText: 'UT, USA',
          location: LOCATION,
        },
      ],
    })
    const user = setup()
    const { onAddStop } = renderForm()
    await openDrawer(user)
    await user.type(screen.getByLabelText('Stop title'), 'My Camp')
    await typeAddress(user, 'Arches')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    await user.click(await screen.findByRole('button', { name: /Arches National Park/ }))

    expect(screen.getByLabelText('Stop title')).toHaveValue('My Camp')
    await clickSave(user)
    expect(onAddStop).toHaveBeenCalledTimes(1)
    expect((onAddStop.mock.calls[0][0] as TripStop).label).toBe('My Camp')
  })
})

describe('TripForm stop card and drawer controls', () => {
  it('renders "Dates not set" on a stop card with no dates', () => {
    renderForm([
      {
        id: 'stop-1',
        label: 'Moab',
        address: ADDRESS,
        startDate: '',
        endDate: '',
        status: 'idle',
      } as TripStop,
    ])
    expect(screen.getByText('Dates not set')).toBeInTheDocument()
  })

  it('toggles the manual-entry control text and exposes the starting-point checkbox by label', async () => {
    const user = setup()
    renderForm()
    await openDrawer(user)

    await user.click(screen.getByRole('button', { name: "Can't find it? Enter manually" }))
    expect(
      screen.getByRole('button', { name: 'Use address search instead' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: "Can't find it? Enter manually" }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Use address search instead' }))
    expect(
      screen.getByRole('button', { name: "Can't find it? Enter manually" }),
    ).toBeInTheDocument()

    const startPoint = screen.getByLabelText('Starting point')
    expect(startPoint).toHaveAttribute('type', 'checkbox')
    await user.click(startPoint)
    expect(startPoint).toBeChecked()
  })
})
