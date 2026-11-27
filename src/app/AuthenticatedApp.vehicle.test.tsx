import { forwardRef } from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Trip } from '../domain/trip/types'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  logout: vi.fn(),
  loadTrips: vi.fn(),
  saveTrip: vi.fn(),
  deleteTrip: vi.fn(),
  saveTripSelection: vi.fn(),
  importTrips: vi.fn(),
  readLegacyLocalTrips: vi.fn(),
  clearLegacyLocalTrips: vi.fn(),
  costSpy: vi.fn(),
}))

vi.mock('../hooks/useAuth', () => ({ useAuth: mocks.useAuth }))
vi.mock('../services/storage/tripStorage', () => ({
  loadTrips: mocks.loadTrips,
  saveTrip: mocks.saveTrip,
  deleteTrip: mocks.deleteTrip,
  saveTripSelection: mocks.saveTripSelection,
  importTrips: mocks.importTrips,
  readLegacyLocalTrips: mocks.readLegacyLocalTrips,
  clearLegacyLocalTrips: mocks.clearLegacyLocalTrips,
  createNewTrip: (name: string) => ({
    id: `new-${name}`,
    name,
    stops: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  }),
  getCurrentTrip: (state: { trips: Trip[]; currentTripId: string | null }) =>
    state.trips.find((t) => t.id === state.currentTripId) ?? null,
  getTripsSortedByRecent: (trips: Trip[]) => trips,
}))
vi.mock('../features/admin/AccessRequestsPanel', () => ({ AccessRequestsPanel: () => null }))
vi.mock('../features/map/TripMap', () => ({ TripMap: () => <div data-testid="trip-map" /> }))
vi.mock('../features/trip/TripForm', () => ({
  TripForm: forwardRef(function TripFormStub() {
    return <div data-testid="trip-form" />
  }),
}))
vi.mock('../features/trip/TripSelector', () => ({
  TripSelector: ({
    tripsState,
    onCreateTrip,
    onRenameTrip,
  }: {
    tripsState: { trips: Trip[] }
    onCreateTrip: (name: string) => void
    onRenameTrip: (id: string, name: string) => void
  }) => (
    <>
      <ul data-testid="trip-names">
        {tripsState.trips.map((t) => (
          <li key={t.id}>{t.name}</li>
        ))}
      </ul>
      <button type="button" onClick={() => onCreateTrip('Fresh')}>
        create-trip
      </button>
      <button type="button" onClick={() => onRenameTrip('t1', 'Mine')}>
        rename-t1
      </button>
    </>
  ),
}))
vi.mock('../features/trip/VehicleSettingsModal', () => ({
  VehicleSettingsModal: ({ isOpen, selectedVehicleId }: { isOpen: boolean; selectedVehicleId?: string }) =>
    isOpen ? <div data-testid="vehicle-dialog">{selectedVehicleId}</div> : null,
}))
vi.mock('../components/common/ThemeToggle', () => ({ ThemeToggle: () => null }))
vi.mock('../components/common/FloatingActionButtons', () => ({ FloatingActionButtons: () => null }))
vi.mock('../hooks/useVehicleSettings', () => {
  const garage = {
    vehicles: [
      { id: 'v1', name: 'Big Rig', fuelType: 'diesel', mpg: 10, tankGallons: null },
      { id: 'v2', name: '', fuelType: 'gasoline', mpg: 20, tankGallons: null },
    ],
    defaultVehicleId: 'v1',
  }
  return {
    useVehicleSettingsContext: () => ({ garage, debouncedGarage: garage }),
  }
})
vi.mock('../hooks/useVehicleProfileSync', () => ({ useVehicleProfileSync: () => undefined }))
vi.mock('../services/gas/fuelPriceClient', () => ({
  loadFuelPrices: vi.fn().mockResolvedValue({ kind: 'error', status: 0, error: 'mocked' }),
}))
vi.mock('../hooks/useRoutesEnabled', () => ({ useRoutesEnabled: () => [false] }))
vi.mock('../services/print/printTripPdf', () => ({ downloadTripPdf: vi.fn() }))
vi.mock('../services/gas/gasPriceService', () => ({
  gasPriceService: { getPriceForState: vi.fn().mockResolvedValue({ pricePerGallon: 4 }) },
}))
vi.mock('../utils/costCalculation', async (importActual) => {
  const actual = await importActual<typeof import('../utils/costCalculation')>()
  return { ...actual, calculateStopCostsWithPrices: mocks.costSpy }
})

import App from './App'

const makeTrip = (vehicleId?: string): Trip => ({
  id: 't1',
  name: 'Trip',
  stops: [
    {
      id: 's1',
      label: 'Start',
      address: 'Austin, TX',
      startDate: '2025-06-01',
      endDate: '2025-06-02',
      location: { lat: 30, lng: -97 },
      distanceFromPreviousMeters: 160934,
    },
  ],
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  ...(vehicleId ? { vehicleId } : {}),
})

const load = (vehicleId?: string) =>
  mocks.loadTrips.mockResolvedValue({
    kind: 'loaded' as const,
    trips: [{ trip: makeTrip(vehicleId), version: 1 }],
    currentTripId: 't1',
  })

const picker = () => screen.findByRole('combobox', { name: 'Vehicle for this trip' })

beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState(null, '', '/')
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  )
  mocks.useAuth.mockReturnValue({
    status: 'authenticated',
    user: { id: 'u1', email: 'u1@x.com', isAdmin: false },
    logout: mocks.logout,
  })
  mocks.costSpy.mockImplementation((stops: Trip['stops']) => stops)
  mocks.saveTrip.mockResolvedValue({ kind: 'saved', version: 2 })
  mocks.saveTripSelection.mockResolvedValue({ kind: 'saved' })
  mocks.importTrips.mockResolvedValue({ kind: 'imported', imported: [], skipped: [] })
  mocks.readLegacyLocalTrips.mockReturnValue(null)
  load()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('trip vehicle picker', () => {
  it('lists garage vehicles with the default marked', async () => {
    render(<App />)
    const select = await picker()
    const labels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent)
    expect(labels).toEqual(['Big Rig (default)', 'Unnamed vehicle'])
    expect(select).toHaveValue('v1')
  })

  it('shows the default vehicle when the trip vehicleId is unknown', async () => {
    load('gone')
    render(<App />)
    expect(await picker()).toHaveValue('v1')
  })

  it('shows the trip vehicle and persists a changed vehicleId', async () => {
    render(<App />)
    const select = await picker()
    fireEvent.change(select, { target: { value: 'v2' } })
    expect(select).toHaveValue('v2')
    await waitFor(() =>
      expect(mocks.saveTrip).toHaveBeenCalledWith(
        expect.objectContaining({ vehicleId: 'v2' }),
        expect.anything(),
      ),
    )
  })

  it('prices the trip with the selected vehicle MPG', async () => {
    render(<App />)
    const select = await picker()
    await waitFor(() => expect(mocks.costSpy).toHaveBeenCalledWith(expect.anything(), 10, expect.anything()))
    fireEvent.change(select, { target: { value: 'v2' } })
    await waitFor(() => expect(mocks.costSpy).toHaveBeenCalledWith(expect.anything(), 20, expect.anything()))
  })

  it('opens the vehicle dialog from Manage with the trip vehicle selected', async () => {
    load('v2')
    render(<App />)
    await picker()
    fireEvent.click(screen.getByRole('button', { name: 'Manage vehicles' }))
    expect(screen.getByTestId('vehicle-dialog')).toHaveTextContent('v2')
  })
})
