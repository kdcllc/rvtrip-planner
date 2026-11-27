// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TripStop } from '../../domain/trip/types'
import { formatDateRange } from '../../utils/date'

vi.mock('../../services/geocoding/geocodingService', () => ({
  geocodeAddress: vi.fn(),
}))
vi.mock('../../services/geocoding/autocompleteService', () => ({
  fetchAutocompleteSuggestions: vi.fn(async () => ({ suggestions: [] })),
}))
vi.mock('../../services/campsiteSearch', () => ({
  openExternalLink: vi.fn(),
  extractStateFromAddress: vi.fn(() => null),
}))

import { TripForm } from './TripForm'

const makeStop = (
  id: string,
  label: string,
  startDate: string,
  endDate: string
): TripStop => ({
  id,
  label,
  address: `${label} address`,
  startDate,
  endDate,
  location: { lat: 38.5, lng: -109.5 },
})

const stopA = makeStop('a', 'Alpha Camp', '2026-06-01', '2026-06-05')
const stopB = makeStop('b', 'Bravo Park', '2026-06-05', '2026-06-07')
const stops = [stopA, stopB]

const barName = (stop: TripStop, nights: string) =>
  `${stop.label}, ${formatDateRange(stop.startDate, stop.endDate)}, ${nights}`

const renderForm = (currentStopId: string | null = null) => {
  const onSelectStop = vi.fn()
  const onCurrentStopChange = vi.fn()
  render(
    <TripForm
      stops={stops}
      onAddStop={vi.fn()}
      onRemoveStop={vi.fn()}
      onUpdateStop={vi.fn()}
      onReorderStop={vi.fn()}
      selectedStopIds={new Set()}
      onToggleStopSelection={vi.fn()}
      onSelectAllStops={vi.fn()}
      onClearStopSelection={vi.fn()}
      currentStopId={currentStopId}
      onCurrentStopChange={onCurrentStopChange}
      onSelectStop={onSelectStop}
    />
  )
  return { onSelectStop, onCurrentStopChange }
}

let scrollIntoView: ReturnType<typeof vi.fn>
let originalScrollIntoView: typeof Element.prototype.scrollIntoView | undefined

beforeEach(() => {
  originalScrollIntoView = Element.prototype.scrollIntoView
  scrollIntoView = vi.fn()
  Element.prototype.scrollIntoView = scrollIntoView as unknown as typeof Element.prototype.scrollIntoView
})

afterEach(() => {
  if (originalScrollIntoView) {
    Element.prototype.scrollIntoView = originalScrollIntoView
  } else {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('TripForm timeline wiring', () => {
  it('T12 clicking a timeline bar selects the stop, reports it as current and never calls scrollIntoView', () => {
    const { onSelectStop, onCurrentStopChange } = renderForm()
    fireEvent.click(screen.getByRole('button', { name: barName(stopB, '2 nights') }))
    expect(onSelectStop).toHaveBeenCalledTimes(1)
    expect(onSelectStop).toHaveBeenCalledWith('b')
    expect(onCurrentStopChange).toHaveBeenLastCalledWith('b')
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('T13 the Details button scrolls the stop card into view with nearest/center', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: false })
    )
    renderForm('b')
    fireEvent.click(screen.getByRole('button', { name: 'Show details for Bravo Park' }))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'nearest', inline: 'center' })
    )
    expect(scrollIntoView.mock.contexts[0]).toBe(
      document.querySelector('.stop-item[data-stop-id="b"]')
    )
  })
})
