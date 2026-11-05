import { forwardRef } from 'react'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TripsState } from '../domain/trip/types'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  logout: vi.fn(),
  loadTripsFromStorage: vi.fn(),
  saveTripsToStorage: vi.fn(),
  readLegacyLocalTrips: vi.fn(),
  clearLegacyLocalTrips: vi.fn(),
}))

vi.mock('../hooks/useAuth', () => ({ useAuth: mocks.useAuth }))
vi.mock('../features/auth/AuthScreen', () => ({
  AuthScreen: () => <div data-testid="auth-screen" />,
}))
vi.mock('../services/storage/tripStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/storage/tripStorage')>()
  return {
    ...actual,
    loadTripsFromStorage: mocks.loadTripsFromStorage,
    saveTripsToStorage: mocks.saveTripsToStorage,
    readLegacyLocalTrips: mocks.readLegacyLocalTrips,
    clearLegacyLocalTrips: mocks.clearLegacyLocalTrips,
  }
})
vi.mock('../features/map/TripMap', () => ({ TripMap: () => <div data-testid="trip-map" /> }))
vi.mock('../features/trip/TripForm', () => ({
  TripForm: forwardRef(function TripFormStub() {
    return <div data-testid="trip-form" />
  }),
}))
vi.mock('../features/trip/TripSelector', () => ({
  TripSelector: ({ onCreateTrip }: { onCreateTrip: (name: string) => void }) => (
    <button type="button" onClick={() => onCreateTrip('New one')}>
      create-trip
    </button>
  ),
}))
vi.mock('../features/trip/VehicleSettingsModal', () => ({ VehicleSettingsModal: () => null }))
vi.mock('../components/common/ThemeToggle', () => ({ ThemeToggle: () => null }))
vi.mock('../components/common/FloatingActionButtons', () => ({ FloatingActionButtons: () => null }))
vi.mock('../hooks/useVehicleSettings', () => ({
  useVehicleSettingsContext: () => ({ debouncedMpg: 10 }),
}))
vi.mock('../hooks/useRoutesEnabled', () => ({ useRoutesEnabled: () => [false] }))
vi.mock('../services/print/printTripPdf', () => ({ downloadTripPdf: vi.fn() }))
vi.mock('../services/gas/gasPriceService', () => ({
  gasPriceService: { getPriceForState: vi.fn() },
}))

import App from './App'

const serverState: TripsState = {
  trips: [{ id: 't1', name: 'Server', stops: [], createdAt: 'x', updatedAt: 'x' }],
  currentTripId: 't1',
}
const legacyState: TripsState = {
  trips: [{ id: 'old1', name: 'Old', stops: [], createdAt: 'x', updatedAt: 'x' }],
  currentTripId: 'old1',
}

const setAuth = (status: string, id = 'u1') =>
  mocks.useAuth.mockReturnValue({
    status,
    user: status === 'authenticated' ? { id, email: `${id}@x.com` } : null,
    logout: mocks.logout,
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  )
  mocks.logout.mockResolvedValue({ kind: 'success', status: 200, data: { ok: true } })
  mocks.loadTripsFromStorage.mockResolvedValue({ kind: 'loaded', state: serverState, isNew: false })
  mocks.saveTripsToStorage.mockResolvedValue({ kind: 'saved' })
  mocks.readLegacyLocalTrips.mockReturnValue(null)
})

describe('App auth gating', () => {
  it('renders no planner and makes no trips calls when unauthenticated', () => {
    setAuth('unauthenticated')
    render(<App />)
    expect(screen.getByTestId('auth-screen')).toBeInTheDocument()
    expect(screen.queryByTestId('trip-map')).not.toBeInTheDocument()
    expect(screen.queryByTestId('trip-form')).not.toBeInTheDocument()
    expect(mocks.loadTripsFromStorage).not.toHaveBeenCalled()
    expect(mocks.saveTripsToStorage).not.toHaveBeenCalled()
    expect(mocks.readLegacyLocalTrips).not.toHaveBeenCalled()
  })

  it('renders checking and waking states without planner or trips calls', () => {
    setAuth('checking')
    const { unmount } = render(<App />)
    expect(screen.getByText(/checking your session/i)).toBeInTheDocument()
    unmount()
    setAuth('databaseWaking')
    render(<App />)
    expect(screen.getByText(/waking up/i)).toBeInTheDocument()
    expect(screen.queryByTestId('trip-map')).not.toBeInTheDocument()
    expect(mocks.loadTripsFromStorage).not.toHaveBeenCalled()
  })

  it('renders the planner when authenticated', async () => {
    setAuth('authenticated')
    render(<App />)
    expect(await screen.findByTestId('trip-map')).toBeInTheDocument()
    expect(screen.getByTestId('trip-form')).toBeInTheDocument()
    expect(mocks.loadTripsFromStorage).toHaveBeenCalledTimes(1)
  })

  it('signs out via the sign-out control', async () => {
    setAuth('authenticated')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /sign out/i }))
    expect(mocks.logout).toHaveBeenCalledTimes(1)
  })

  it('sign out flushes a pending debounced save BEFORE logout', async () => {
    setAuth('authenticated')
    const order: string[] = []
    mocks.saveTripsToStorage.mockImplementation(async () => {
      order.push('save')
      return { kind: 'saved' }
    })
    mocks.logout.mockImplementation(async () => {
      order.push('logout')
      return { kind: 'success', status: 200, data: { ok: true } }
    })
    render(<App />)
    // Create a trip so a debounced (800ms) save is pending, then sign out immediately.
    fireEvent.click(await screen.findByRole('button', { name: 'create-trip' }))
    expect(mocks.saveTripsToStorage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    await waitFor(() => expect(order).toEqual(['save', 'logout']))
    expect(mocks.saveTripsToStorage.mock.calls[0][0].trips).toHaveLength(2)
  })

  it('falls back to an error state (not an endless loading screen) when logout fails on the 401 path', async () => {
    setAuth('authenticated')
    mocks.loadTripsFromStorage.mockResolvedValue({ kind: 'session-expired' })
    mocks.logout.mockRejectedValue(new Error('network down'))
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/signed out|session/i)
    expect(screen.queryByText(/loading your trips/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('returns to the auth screen after a mid-session 401', async () => {
    setAuth('authenticated')
    mocks.loadTripsFromStorage.mockResolvedValue({ kind: 'session-expired' })
    // logout drops auth state, as the real provider does on a 401
    mocks.logout.mockImplementation(async () => {
      setAuth('unauthenticated')
      rerender(<App />)
      return { kind: 'auth-failure', status: 401, error: 'x' }
    })
    const { rerender } = render(<App />)
    expect(await screen.findByTestId('auth-screen')).toBeInTheDocument()
    expect(screen.queryByTestId('trip-map')).not.toBeInTheDocument()
  })

  it('shows the waking state when trips load reports database-waking', async () => {
    setAuth('authenticated')
    mocks.loadTripsFromStorage.mockResolvedValue({ kind: 'database-waking', retryAfterSeconds: 60 })
    render(<App />)
    expect(await screen.findByText(/waking up/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('surfaces a trips load error', async () => {
    setAuth('authenticated')
    mocks.loadTripsFromStorage.mockResolvedValue({ kind: 'error', message: 'boom' })
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })
})

describe('first-login legacy import', () => {
  it('PUTs legacy trips once and clears local storage only after the PUT resolves', async () => {
    setAuth('authenticated', 'import-ok')
    mocks.loadTripsFromStorage.mockResolvedValue({ kind: 'loaded', state: serverState, isNew: true })
    mocks.readLegacyLocalTrips.mockReturnValue(legacyState)
    const order: string[] = []
    mocks.saveTripsToStorage.mockImplementation(async () => {
      order.push('put')
      return { kind: 'saved' }
    })
    mocks.clearLegacyLocalTrips.mockImplementation(() => order.push('clear'))

    render(<App />)
    expect(await screen.findByText(/imported 1 existing local trip/i)).toBeInTheDocument()
    expect(mocks.saveTripsToStorage).toHaveBeenCalledTimes(1)
    expect(mocks.saveTripsToStorage.mock.calls[0][0].trips.map((t: { id: string }) => t.id)).toEqual(['old1'])
    expect(order).toEqual(['put', 'clear'])
  })

  it('does not clear local storage when the PUT fails', async () => {
    setAuth('authenticated', 'import-fail')
    mocks.readLegacyLocalTrips.mockReturnValue(legacyState)
    mocks.saveTripsToStorage.mockResolvedValue({ kind: 'error', message: 'nope' })
    render(<App />)
    expect(await screen.findByTestId('trip-map')).toBeInTheDocument()
    expect(mocks.saveTripsToStorage).toHaveBeenCalledTimes(1)
    expect(mocks.clearLegacyLocalTrips).not.toHaveBeenCalled()
    expect(screen.getByText(/could not be imported/i)).toBeInTheDocument()
  })

  it('does not re-run the import on a subsequent login of the same account', async () => {
    setAuth('authenticated', 'import-once')
    mocks.readLegacyLocalTrips.mockReturnValue(legacyState)
    const first = render(<App />)
    await waitFor(() => expect(mocks.clearLegacyLocalTrips).toHaveBeenCalledTimes(1))
    await screen.findByTestId('trip-map')
    first.unmount()
    cleanup()

    render(<App />)
    await screen.findByTestId('trip-map')
    expect(mocks.saveTripsToStorage).toHaveBeenCalledTimes(1)
    expect(mocks.clearLegacyLocalTrips).toHaveBeenCalledTimes(1)
  })
})
