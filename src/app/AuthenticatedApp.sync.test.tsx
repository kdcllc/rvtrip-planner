import { forwardRef } from 'react'
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react'
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
vi.mock('../features/trip/VehicleSettingsModal', () => ({ VehicleSettingsModal: () => null }))
vi.mock('../components/common/ThemeToggle', () => ({ ThemeToggle: () => null }))
vi.mock('../components/common/FloatingActionButtons', () => ({ FloatingActionButtons: () => null }))
vi.mock('../hooks/useVehicleSettings', () => ({
  useVehicleSettingsContext: () => ({
    debouncedMpg: 10,
    profile: { name: '', fuelType: 'gasoline', mpg: 10, tankGallons: null },
    debouncedProfile: { name: '', fuelType: 'gasoline', mpg: 10, tankGallons: null },
  }),
}))
vi.mock('../hooks/useVehicleProfileSync', () => ({ useVehicleProfileSync: () => undefined }))
vi.mock('../services/gas/fuelPriceClient', () => ({
  loadFuelPrices: vi.fn().mockResolvedValue({ kind: 'error', status: 0, error: 'mocked' }),
}))
vi.mock('../hooks/useRoutesEnabled', () => ({ useRoutesEnabled: () => [false] }))
vi.mock('../services/print/printTripPdf', () => ({ downloadTripPdf: vi.fn() }))
vi.mock('../services/gas/gasPriceService', () => ({
  gasPriceService: { getPriceForState: vi.fn() },
}))

import App from './App'

const makeTrip = (id: string, name: string): Trip => ({
  id,
  name,
  stops: [],
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
})

const loaded = (name: string) => ({
  kind: 'loaded' as const,
  trips: [{ trip: makeTrip('t1', name), version: 3 }],
  currentTripId: 't1',
})

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

const syncButton = () => screen.getByRole('button', { name: /^Sync/ })
const names = () =>
  Array.from(screen.getByTestId('trip-names').querySelectorAll('li')).map((li) => li.textContent)

const setVisibility = (state: 'visible' | 'hidden') =>
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })

const renderPlanner = async () => {
  vi.useFakeTimers()
  render(<App />)
  await advance(0)
  expect(screen.getByTestId('trip-map')).toBeInTheDocument()
}

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
  mocks.logout.mockResolvedValue({ kind: 'success', status: 200, data: { ok: true } })
  mocks.loadTrips.mockResolvedValue(loaded('Original'))
  mocks.saveTrip.mockResolvedValue({ kind: 'saved', version: 1 })
  mocks.deleteTrip.mockResolvedValue({ kind: 'saved' })
  mocks.saveTripSelection.mockResolvedValue({ kind: 'saved' })
  mocks.importTrips.mockResolvedValue({ kind: 'imported', imported: [], skipped: [] })
  mocks.readLegacyLocalTrips.mockReturnValue(null)
})

afterEach(() => {
  cleanup()
  setVisibility('visible')
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('manual Sync', () => {
  it('sits next to Sign out and is labelled "Sync"', async () => {
    await renderPlanner()
    const signOut = screen.getByRole('button', { name: /sign out/i })
    expect(syncButton()).toHaveTextContent('Sync')
    expect(signOut.nextElementSibling).toBe(syncButton())
    expect(syncButton()).toHaveAttribute('aria-busy', 'false')
  })

  it('loads the server copy and shows the changed trip name plus a "Synced at" status', async () => {
    await renderPlanner()
    expect(names()).toEqual(['Original'])
    mocks.loadTrips.mockResolvedValue(loaded('Renamed elsewhere'))
    fireEvent.click(syncButton())
    await advance(0)
    expect(names()).toEqual(['Renamed elsewhere'])
    expect(screen.getByRole('status')).toHaveTextContent(/^Synced at/)
    expect(mocks.loadTrips).toHaveBeenCalledTimes(2)
  })

  it('shows "Syncing…", disables the button and sets aria-busy while pending, then restores it', async () => {
    await renderPlanner()
    let resolve!: (v: ReturnType<typeof loaded>) => void
    mocks.loadTrips.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    fireEvent.click(syncButton())
    await advance(0)
    expect(syncButton()).toHaveTextContent('Syncing…')
    expect(syncButton()).toBeDisabled()
    expect(syncButton()).toHaveAttribute('aria-busy', 'true')
    await act(async () => {
      resolve(loaded('Original'))
    })
    expect(syncButton()).toHaveTextContent('Sync')
    expect(syncButton()).toBeEnabled()
    expect(syncButton()).toHaveAttribute('aria-busy', 'false')
  })

  it('shows the error message when the load fails and keeps the local trips', async () => {
    await renderPlanner()
    mocks.loadTrips.mockResolvedValue({ kind: 'error', message: 'Server exploded' })
    fireEvent.click(syncButton())
    await advance(0)
    expect(screen.getByRole('status')).toHaveTextContent('Server exploded')
    expect(names()).toEqual(['Original'])
  })

  it('treats session-expired as a sign-out (logout called, no success message)', async () => {
    await renderPlanner()
    mocks.loadTrips.mockResolvedValue({ kind: 'session-expired' })
    fireEvent.click(syncButton())
    await advance(0)
    expect(mocks.logout).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/^Synced at/)).not.toBeInTheDocument()
  })

  it('reports the database still waking after retries are exhausted', async () => {
    await renderPlanner()
    mocks.loadTrips.mockResolvedValue({ kind: 'database-waking', retryAfterSeconds: 1 })
    fireEvent.click(syncButton())
    await advance(60000)
    expect(screen.getByRole('status')).toHaveTextContent(
      'The database is still waking up. Please try again.',
    )
  })

  it('tells the user when a local edit is replaced by the server copy', async () => {
    await renderPlanner()
    mocks.saveTrip.mockResolvedValue({ kind: 'error', message: 'offline', retryable: true })
    fireEvent.click(screen.getByRole('button', { name: 'rename-t1' }))
    expect(names()).toEqual(['Mine'])
    mocks.loadTrips.mockResolvedValue(loaded('Server name'))
    fireEvent.click(syncButton())
    await advance(0)
    expect(names()).toEqual(['Server name'])
    expect(screen.getByText(
      'Server copy kept for: Mine. Edits to these trips on this device were not saved.',
    )).toBeInTheDocument()
    expect(screen.queryByText(/^Synced at/)).not.toBeInTheDocument()
  })

  it('does not overwrite edits made while the sync request is in flight', async () => {
    await renderPlanner()
    let resolve!: (v: ReturnType<typeof loaded>) => void
    mocks.loadTrips.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    fireEvent.click(syncButton())
    await advance(0)
    fireEvent.click(screen.getByRole('button', { name: 'create-trip' }))
    await act(async () => {
      resolve(loaded('Server name'))
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your trips changed while syncing — press Sync again.',
    )
    expect(names()).toContain('Fresh')
    expect(names()).toContain('Original')
    expect(names()).not.toContain('Server name')
  })
})

describe('auto sync on tab focus', () => {
  it('syncs on visibilitychange (visible) after 30 s, silently', async () => {
    await renderPlanner()
    mocks.loadTrips.mockResolvedValue(loaded('From other device'))
    await advance(31000)
    expect(mocks.loadTrips).toHaveBeenCalledTimes(1)
    setVisibility('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await advance(0)
    expect(mocks.loadTrips).toHaveBeenCalledTimes(2)
    expect(names()).toEqual(['From other device'])
    expect(screen.queryByText(/^Synced at/)).not.toBeInTheDocument()
  })

  it('syncs on window focus after 30 s', async () => {
    await renderPlanner()
    await advance(31000)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await advance(0)
    expect(mocks.loadTrips).toHaveBeenCalledTimes(2)
  })

  it('does not sync before 30 s have passed since mount', async () => {
    await renderPlanner()
    await advance(10000)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await advance(0)
    expect(mocks.loadTrips).toHaveBeenCalledTimes(1)
  })

  it('does not sync when the document becomes hidden', async () => {
    await renderPlanner()
    await advance(31000)
    setVisibility('hidden')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await advance(0)
    expect(mocks.loadTrips).toHaveBeenCalledTimes(1)
  })

  it('does not sync while there are unsaved edits', async () => {
    await renderPlanner()
    mocks.saveTrip.mockResolvedValue({ kind: 'error', message: 'offline', retryable: true })
    fireEvent.click(screen.getByRole('button', { name: 'rename-t1' }))
    await advance(31000)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await advance(0)
    expect(mocks.loadTrips).toHaveBeenCalledTimes(1)
    expect(names()).toEqual(['Mine'])
  })
})
