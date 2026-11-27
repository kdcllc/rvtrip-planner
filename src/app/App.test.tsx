import { forwardRef } from 'react'
import { act, render, screen, fireEvent, cleanup, within } from '@testing-library/react'
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
vi.mock('../features/auth/AuthScreen', () => ({
  AuthScreen: ({ initialMode, onBack }: { initialMode?: string; onBack?: () => void }) => (
    <div data-testid="auth-screen" data-mode={initialMode}>
      <button type="button" onClick={onBack}>
        back
      </button>
    </div>
  ),
}))
vi.mock('../features/landing/LandingPage', () => ({
  LandingPage: ({ onSignUp, onLogIn }: { onSignUp: () => void; onLogIn: () => void }) => (
    <div data-testid="landing">
      <button type="button" onClick={onSignUp}>
        landing-sign-up
      </button>
      <button type="button" onClick={onLogIn}>
        landing-log-in
      </button>
    </div>
  ),
}))
vi.mock('../features/admin/AccessRequestsPanel', () => ({
  AccessRequestsPanel: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="access-panel">
      <button type="button" onClick={onClose}>
        close-panel
      </button>
    </div>
  ),
}))
vi.mock('../services/storage/tripStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/storage/tripStorage')>()
  return {
    ...actual,
    loadTrips: mocks.loadTrips,
    saveTrip: mocks.saveTrip,
    deleteTrip: mocks.deleteTrip,
    saveTripSelection: mocks.saveTripSelection,
    importTrips: mocks.importTrips,
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
  TripSelector: ({
    onCreateTrip,
    onRequestDelete,
    onDownloadTrip,
  }: {
    onCreateTrip: (name: string) => void
    onRequestDelete: (id: string) => void
    onDownloadTrip: (id: string) => void
  }) => (
    <>
      <button type="button" onClick={() => onCreateTrip('New one')}>
        create-trip
      </button>
      <button type="button" onClick={() => onRequestDelete('t1')}>
        delete-t1
      </button>
      <button type="button" onClick={() => onDownloadTrip('t1')}>
        download-t1
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
const serverTrip = makeTrip('t1', 'Server')
const legacyTrip = makeTrip('old1', 'Old')
const legacyState = { trips: [legacyTrip], currentTripId: 'old1' }

const setAuth = (status: string, opts: { id?: string; isAdmin?: boolean } = {}) =>
  mocks.useAuth.mockReturnValue({
    status,
    user:
      status === 'authenticated'
        ? { id: opts.id ?? 'u1', email: `${opts.id ?? 'u1'}@x.com`, isAdmin: opts.isAdmin ?? false }
        : null,
    logout: mocks.logout,
  })

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

/** Renders the authenticated app under fake timers and waits for the planner to load. */
const renderPlanner = async () => {
  vi.useFakeTimers()
  const view = render(<App />)
  await advance(0)
  expect(screen.getByTestId('trip-map')).toBeInTheDocument()
  return view
}

const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(blob)
  })

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
  mocks.logout.mockResolvedValue({ kind: 'success', status: 200, data: { ok: true } })
  mocks.loadTrips.mockResolvedValue({
    kind: 'loaded',
    trips: [{ trip: serverTrip, version: 3 }],
    currentTripId: 't1',
  })
  mocks.saveTrip.mockResolvedValue({ kind: 'saved', version: 1 })
  mocks.deleteTrip.mockResolvedValue({ kind: 'saved' })
  mocks.saveTripSelection.mockResolvedValue({ kind: 'saved' })
  mocks.importTrips.mockResolvedValue({ kind: 'imported', imported: [], skipped: [] })
  mocks.readLegacyLocalTrips.mockReturnValue(null)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('App landing and auth gating', () => {
  it('shows the landing page (no planner, no trips calls) when signed out', () => {
    setAuth('unauthenticated')
    render(<App />)
    expect(screen.getByTestId('landing')).toBeInTheDocument()
    expect(screen.queryByTestId('auth-screen')).not.toBeInTheDocument()
    expect(screen.queryByTestId('trip-map')).not.toBeInTheDocument()
    expect(mocks.loadTrips).not.toHaveBeenCalled()
    expect(mocks.readLegacyLocalTrips).not.toHaveBeenCalled()
  })

  it('Sign up opens register, Log in opens login, and Back returns to the landing page', () => {
    setAuth('unauthenticated')
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'landing-sign-up' }))
    expect(screen.getByTestId('auth-screen')).toHaveAttribute('data-mode', 'register')
    fireEvent.click(screen.getByRole('button', { name: 'back' }))
    expect(screen.getByTestId('landing')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'landing-log-in' }))
    expect(screen.getByTestId('auth-screen')).toHaveAttribute('data-mode', 'login')
  })

  it('a ?invite= URL opens the register screen directly', () => {
    window.history.replaceState(null, '', '/?invite=ABC123')
    setAuth('unauthenticated')
    render(<App />)
    expect(screen.getByTestId('auth-screen')).toHaveAttribute('data-mode', 'register')
    expect(screen.queryByTestId('landing')).not.toBeInTheDocument()
  })

  it('a password-reset token URL opens the auth screen directly', () => {
    window.history.replaceState(null, '', '/reset-password?token=tok')
    setAuth('unauthenticated')
    render(<App />)
    expect(screen.getByTestId('auth-screen')).toBeInTheDocument()
    expect(screen.queryByTestId('landing')).not.toBeInTheDocument()
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
    expect(mocks.loadTrips).not.toHaveBeenCalled()
  })

  it('renders the planner when authenticated and loads trips once', async () => {
    setAuth('authenticated')
    render(<App />)
    expect(await screen.findByTestId('trip-map')).toBeInTheDocument()
    expect(screen.getByTestId('trip-form')).toBeInTheDocument()
    expect(mocks.loadTrips).toHaveBeenCalledTimes(1)
  })

  it('falls back to an error state when logout fails on the 401 path', async () => {
    setAuth('authenticated')
    mocks.loadTrips.mockResolvedValue({ kind: 'session-expired' })
    mocks.logout.mockRejectedValue(new Error('network down'))
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/signed out|session/i)
    expect(screen.queryByText(/loading your trips/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('returns to the landing page after a mid-session 401', async () => {
    setAuth('authenticated')
    mocks.loadTrips.mockResolvedValue({ kind: 'session-expired' })
    mocks.logout.mockImplementation(async () => {
      setAuth('unauthenticated')
      rerender(<App />)
      return { kind: 'auth-failure', status: 401, error: 'x' }
    })
    const { rerender } = render(<App />)
    expect(await screen.findByTestId('landing')).toBeInTheDocument()
    expect(screen.queryByTestId('trip-map')).not.toBeInTheDocument()
  })

  it('shows the waking state when trips load reports database-waking', async () => {
    setAuth('authenticated')
    mocks.loadTrips.mockResolvedValue({ kind: 'database-waking', retryAfterSeconds: 60 })
    render(<App />)
    expect(await screen.findByText(/waking up/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('surfaces a trips load error', async () => {
    setAuth('authenticated')
    mocks.loadTrips.mockResolvedValue({ kind: 'error', message: 'boom' })
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })

  it('signs out via the sign-out control', async () => {
    setAuth('authenticated')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /sign out/i }))
    await vi.waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1))
  })
})

describe('per-trip saving', () => {
  it('sign out flushes a pending debounced save BEFORE logout', async () => {
    setAuth('authenticated')
    const order: string[] = []
    mocks.saveTrip.mockImplementation(async () => {
      order.push('save')
      return { kind: 'saved', version: 1 }
    })
    mocks.logout.mockImplementation(async () => {
      order.push('logout')
      return { kind: 'success', status: 200, data: { ok: true } }
    })
    await renderPlanner()
    fireEvent.click(screen.getByRole('button', { name: 'create-trip' }))
    expect(mocks.saveTrip).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    await advance(0)
    expect(order).toEqual(['save', 'logout'])
    const [trip, base] = mocks.saveTrip.mock.calls[0]
    expect(trip.name).toBe('New one')
    expect(base).toBeNull()
  })

  it('saves only the changed trip after the debounce, then selection', async () => {
    setAuth('authenticated')
    await renderPlanner()
    fireEvent.click(screen.getByRole('button', { name: 'create-trip' }))
    await advance(800)
    expect(mocks.saveTrip).toHaveBeenCalledTimes(1)
    expect(mocks.saveTrip.mock.calls[0][0].name).toBe('New one')
    expect(mocks.saveTripSelection).toHaveBeenCalledTimes(1)
  })

  it('retries after database-waking without user action, then clears the banner', async () => {
    setAuth('authenticated')
    mocks.saveTrip
      .mockResolvedValueOnce({ kind: 'database-waking' })
      .mockResolvedValue({ kind: 'saved', version: 1 })
    await renderPlanner()
    fireEvent.click(screen.getByRole('button', { name: 'create-trip' }))
    await advance(800)
    expect(mocks.saveTrip).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/the database is waking up, retrying automatically/i)).toBeInTheDocument()

    await advance(5000)
    expect(mocks.saveTrip).toHaveBeenCalledTimes(2)
    expect(mocks.saveTrip.mock.calls[1][0].id).toBe(mocks.saveTrip.mock.calls[0][0].id)
    expect(screen.queryByText(/retrying/i)).not.toBeInTheDocument()

    await advance(120_000)
    expect(mocks.saveTrip).toHaveBeenCalledTimes(2)
  })

  it('backs off 5s then 10s on retryable errors, honouring Retry-After when given', async () => {
    setAuth('authenticated')
    mocks.saveTrip
      .mockResolvedValueOnce({ kind: 'error', message: 'net', retryable: true })
      .mockResolvedValueOnce({ kind: 'error', message: 'net', retryable: true })
      .mockResolvedValueOnce({ kind: 'database-waking', retryAfterSeconds: 2 })
      .mockResolvedValue({ kind: 'saved', version: 1 })
    await renderPlanner()
    fireEvent.click(screen.getByRole('button', { name: 'create-trip' }))
    await advance(800)
    expect(screen.getByText(/could not save yet, retrying/i)).toBeInTheDocument()
    await advance(4999)
    expect(mocks.saveTrip).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(mocks.saveTrip).toHaveBeenCalledTimes(2)
    await advance(9999)
    expect(mocks.saveTrip).toHaveBeenCalledTimes(2)
    await advance(1)
    expect(mocks.saveTrip).toHaveBeenCalledTimes(3)
    await advance(2000)
    expect(mocks.saveTrip).toHaveBeenCalledTimes(4)
  })

  it('shows the message and a Retry now button for a non-retryable error', async () => {
    setAuth('authenticated')
    mocks.saveTrip
      .mockResolvedValueOnce({ kind: 'error', message: 'Trip too large', retryable: false })
      .mockResolvedValue({ kind: 'saved', version: 1 })
    await renderPlanner()
    fireEvent.click(screen.getByRole('button', { name: 'create-trip' }))
    await advance(800)
    expect(screen.getByRole('alert')).toHaveTextContent('Trip too large')
    await advance(120_000)
    expect(mocks.saveTrip).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }))
    await advance(0)
    expect(mocks.saveTrip).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('conflict: "Keep my version" re-saves with the server version as base', async () => {
    setAuth('authenticated')
    mocks.saveTrip
      .mockResolvedValueOnce({
        kind: 'conflict',
        current: { trip: makeTrip('x', 'Theirs'), version: 7 },
      })
      .mockResolvedValue({ kind: 'saved', version: 8 })
    await renderPlanner()
    fireEvent.click(screen.getByRole('button', { name: 'create-trip' }))
    await advance(800)
    expect(screen.getByText(/changed in another tab or device/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep my version' }))
    await advance(0)
    expect(mocks.saveTrip).toHaveBeenCalledTimes(2)
    expect(mocks.saveTrip.mock.calls[1][1]).toBe(7)
    expect(screen.queryByText(/changed in another tab or device/i)).not.toBeInTheDocument()
  })

  it('conflict: "Load saved version" replaces the local trip and does not re-save it', async () => {
    setAuth('authenticated')
    mocks.saveTrip.mockResolvedValueOnce({ kind: 'conflict', current: null })
    await renderPlanner()
    fireEvent.click(screen.getByRole('button', { name: 'create-trip' }))
    await advance(800)
    fireEvent.click(screen.getByRole('button', { name: 'Load saved version' }))
    await advance(5000)
    expect(mocks.saveTrip).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/changed in another tab or device/i)).not.toBeInTheDocument()
  })

  it('deleting a trip calls deleteTrip and retries it until it succeeds', async () => {
    setAuth('authenticated')
    mocks.deleteTrip
      .mockResolvedValueOnce({ kind: 'database-waking' })
      .mockResolvedValue({ kind: 'saved' })
    await renderPlanner()
    fireEvent.click(screen.getByRole('button', { name: 'delete-t1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete trip' }))
    await advance(800)
    expect(mocks.deleteTrip).toHaveBeenCalledWith('t1')
    expect(mocks.deleteTrip).toHaveBeenCalledTimes(1)
    await advance(5000)
    expect(mocks.deleteTrip).toHaveBeenCalledTimes(2)
  })

  it('registers a beforeunload prompt only while a trip is dirty', async () => {
    setAuth('authenticated')
    mocks.saveTrip.mockResolvedValue({ kind: 'saved', version: 1 })
    await renderPlanner()
    const fire = () => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(fire()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'create-trip' }))
    expect(fire()).toBe(true)
    await advance(800)
    expect(fire()).toBe(false)
  })
})

describe('browser-local trip import', () => {
  it('imports legacy trips via importTrips and clears the keys only after success', async () => {
    setAuth('authenticated')
    mocks.readLegacyLocalTrips.mockReturnValue(legacyState)
    const order: string[] = []
    mocks.importTrips.mockImplementation(async () => {
      order.push('import')
      return { kind: 'imported', imported: ['old1'], skipped: [] }
    })
    mocks.clearLegacyLocalTrips.mockImplementation(() => order.push('clear'))
    render(<App />)
    expect(
      await screen.findByText('Imported 1 trip from this browser into your account.'),
    ).toBeInTheDocument()
    expect(mocks.importTrips).toHaveBeenCalledWith([legacyTrip])
    expect(order).toEqual(['import', 'clear'])
    // Imported trips are already persisted (version 1): nothing is re-saved.
    expect(mocks.saveTrip).not.toHaveBeenCalled()
  })

  it('mentions trips that were already in the account', async () => {
    setAuth('authenticated')
    mocks.readLegacyLocalTrips.mockReturnValue({
      trips: [legacyTrip, makeTrip('old2', 'Dup')],
      currentTripId: 'old1',
    })
    mocks.importTrips.mockResolvedValue({ kind: 'imported', imported: ['old1'], skipped: ['old2'] })
    render(<App />)
    expect(await screen.findByText(/1 was already in your account/i)).toBeInTheDocument()
    expect(mocks.clearLegacyLocalTrips).toHaveBeenCalledTimes(1)
  })

  it('keeps the local keys and tells the user when the import fails', async () => {
    setAuth('authenticated')
    mocks.readLegacyLocalTrips.mockReturnValue(legacyState)
    mocks.importTrips.mockResolvedValue({ kind: 'error', message: 'nope' })
    render(<App />)
    expect(await screen.findByTestId('trip-map')).toBeInTheDocument()
    expect(mocks.clearLegacyLocalTrips).not.toHaveBeenCalled()
    expect(
      screen.getByText('Your local trips could not be imported yet; they are still on this device.'),
    ).toBeInTheDocument()
  })

  it('retries the import on the next successful load (no once-per-account limit)', async () => {
    setAuth('authenticated', { id: 'same-user' })
    mocks.readLegacyLocalTrips.mockReturnValue(legacyState)
    mocks.importTrips.mockResolvedValueOnce({ kind: 'database-waking' })
    const first = render(<App />)
    await screen.findByTestId('trip-map')
    expect(mocks.clearLegacyLocalTrips).not.toHaveBeenCalled()
    first.unmount()
    cleanup()

    mocks.importTrips.mockResolvedValue({ kind: 'imported', imported: ['old1'], skipped: [] })
    render(<App />)
    await screen.findByText(/imported 1 trip/i)
    expect(mocks.importTrips).toHaveBeenCalledTimes(2)
    expect(mocks.clearLegacyLocalTrips).toHaveBeenCalledTimes(1)
  })
})

describe('downloads', () => {
  const stubDownload = () => {
    const blobs: Blob[] = []
    const names: string[] = []
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
      blobs.push(blob as Blob)
      return 'blob:test'
    })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download)
    })
    return { blobs, names }
  }

  it('Download all trips saves a backup of every trip', async () => {
    setAuth('authenticated')
    const { blobs, names } = stubDownload()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /download all trips/i }))
    expect(names).toHaveLength(1)
    expect(names[0]).toMatch(/^rv-trips-backup-\d{4}-\d{2}-\d{2}\.json$/)
    const payload = JSON.parse(await readBlob(blobs[0]))
    expect(payload.kind).toBe('rv-trip-planner-backup')
    expect(payload.trips).toHaveLength(1)
    expect(payload.trips[0].trip.id).toBe('t1')
  })

  it('Download all trips is disabled when there are no trips', async () => {
    setAuth('authenticated')
    mocks.loadTrips.mockResolvedValue({ kind: 'loaded', trips: [], currentTripId: null })
    render(<App />)
    expect(await screen.findByRole('button', { name: /download all trips/i })).toBeDisabled()
  })

  it('per-trip download saves that trip as a single-trip file', async () => {
    setAuth('authenticated')
    const { blobs, names } = stubDownload()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'download-t1' }))
    expect(names[0]).toMatch(/^trip-.*t1\.json$/)
    expect(JSON.parse(await readBlob(blobs[0])).trip.id).toBe('t1')
  })
})

describe('import file modal', () => {
  it('parses a trip file, imports it via importTrips and merges it into the account', async () => {
    setAuth('authenticated')
    mocks.importTrips.mockResolvedValue({ kind: 'imported', imported: ['f1'], skipped: [] })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /load trip/i }))
    const dialog = screen.getByRole('dialog')
    const file = new File(
      [
        JSON.stringify({
          version: 1,
          trip: { ...makeTrip('f1', 'From file'), stops: [] },
          meta: { exportedAt: 'x' },
        }),
      ],
      'trip.json',
      { type: 'application/json' },
    )
    fireEvent.change(within(dialog).getByLabelText('Trip file'), { target: { files: [file] } })
    const importButton = await within(dialog).findByRole('button', { name: 'Import' })
    await vi.waitFor(() => expect(importButton).toBeEnabled())
    fireEvent.click(importButton)
    await vi.waitFor(() => expect(mocks.importTrips).toHaveBeenCalledTimes(1))
    expect(mocks.importTrips.mock.calls[0][0][0].id).toBe('f1')
    expect(await screen.findByText(/Imported 1 trip\./)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows parse errors inside the modal', async () => {
    setAuth('authenticated')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /load trip/i }))
    const dialog = screen.getByRole('dialog')
    const file = new File(['not json'], 'bad.json', { type: 'application/json' })
    fireEvent.change(within(dialog).getByLabelText('Trip file'), { target: { files: [file] } })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/valid trip data/i)
    expect(mocks.importTrips).not.toHaveBeenCalled()
  })
})

describe('admin entry point', () => {
  it('shows Access requests only to admins and opens the panel', async () => {
    setAuth('authenticated', { isAdmin: true })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Access requests' }))
    expect(screen.getByTestId('access-panel')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'close-panel' }))
    expect(screen.queryByTestId('access-panel')).not.toBeInTheDocument()
  })

  it('never shows Access requests to non-admins', async () => {
    setAuth('authenticated', { isAdmin: false })
    render(<App />)
    await screen.findByTestId('trip-map')
    expect(screen.queryByRole('button', { name: 'Access requests' })).not.toBeInTheDocument()
  })
})
