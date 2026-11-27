// Cross-task client flows: apiClient -> authClient/tripStorage -> AuthProvider -> App UI.
// Only the transport (fetchWithBackoff in services/network/request) and heavy map/form widgets
// are stubbed; the auth and storage layers under test are real.
import { forwardRef } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ fetch: vi.fn() }))

vi.mock('../services/network/request', () => ({ fetchWithBackoff: h.fetch }))
vi.mock('../components/common/ThemeToggle', () => ({ ThemeToggle: () => null }))
vi.mock('../features/map/TripMap', () => ({ TripMap: () => <div data-testid="trip-map" /> }))
vi.mock('../features/trip/TripForm', () => ({
  TripForm: forwardRef(function TripFormStub() {
    return <div data-testid="trip-form" />
  }),
}))
vi.mock('../features/trip/TripSelector', () => ({ TripSelector: () => null }))
vi.mock('../features/trip/VehicleSettingsModal', () => ({ VehicleSettingsModal: () => null }))
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

import App from '../app/App'
import { AuthProvider } from '../hooks/AuthProvider'

type Handler = (method: string, body: unknown) => { status: number; body?: unknown; headers?: Record<string, string> }

const respond = (r: ReturnType<Handler>) =>
  new Response(r.body === undefined ? null : JSON.stringify(r.body), {
    status: r.status,
    headers: { 'Content-Type': 'application/json', ...(r.headers ?? {}) },
  })

/** Installs a path -> handler fake backend behind the transport seam. */
const installBackend = (routes: Record<string, Handler>) => {
  h.fetch.mockImplementation(async (path: string, init: RequestInit = {}) => {
    const route = routes[path]
    if (!route) return respond({ status: 404, body: { error: 'Not found' } })
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    return respond(route(init.method ?? 'GET', body))
  })
}

const callsTo = (path: string, method?: string) =>
  h.fetch.mock.calls.filter(
    (c) => c[0] === path && (method === undefined || (c[1] as RequestInit | undefined)?.method === method),
  )

const waking: Handler = () => ({ status: 503, headers: { 'Retry-After': '20' }, body: { error: 'waking', code: 'DATABASE_UNAVAILABLE' } })
const ok = (body: unknown): Handler => () => ({ status: 200, body })

const renderApp = () =>
  render(
    <AuthProvider>
      <App />
    </AuthProvider>,
  )

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

const legacyTrips = {
  trips: [{ id: 'old1', name: 'Old trip', stops: [], createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' }],
  currentTripId: 'old1',
}

beforeEach(() => {
  h.fetch.mockReset()
  window.localStorage.clear()
  document.cookie = 'csrf_token=tok; path=/'
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  )
})

afterEach(() => {
  vi.useRealTimers()
  document.cookie = 'csrf_token=; Max-Age=0; path=/'
})

describe('503 database-waking path, end to end', () => {
  it('session check: 503 shows the waking state, retries are bounded, then settles on the sign-in screen', async () => {
    vi.useFakeTimers()
    installBackend({ '/api/ping': waking, '/api/me': waking })
    renderApp()

    // First resolve = 1 call + 3 apiClient retries (3 x 5s waits).
    await advance(15_000)
    expect(screen.getByText(/database is waking up/i)).toBeInTheDocument()
    expect(callsTo('/api/me')).toHaveLength(4)

    // AuthProvider performs exactly one more resolve (MAX_WAKE_RETRIES = 1), then gives up.
    await advance(20_000)
    expect(callsTo('/api/me')).toHaveLength(8)
    expect(callsTo('/api/ping')).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument()

    // Bounded: no further traffic however long we wait.
    await advance(120_000)
    expect(callsTo('/api/me')).toHaveLength(8)
    expect(callsTo('/api/ping')).toHaveLength(4)
  })

  it('trips load: 503 surfaces through tripStorage to a waking UI, retries are capped, then an error with retry', async () => {
    vi.useFakeTimers()
    installBackend({
      '/api/ping': ok({ ok: true }),
      '/api/me': ok({ user: { id: 'u-wake', email: 'w@example.com', isAdmin: false } }),
      '/api/trips': waking,
    })
    renderApp()

    await advance(1)
    await advance(15_000)
    expect(screen.getByText(/database is waking up/i)).toBeInTheDocument()

    // 1 initial load + 5 AuthenticatedApp retries, 4 transport attempts each.
    await advance(200_000)
    expect(callsTo('/api/trips', 'GET')).toHaveLength(24)
    expect(screen.getByRole('alert')).toHaveTextContent(/still waking up/i)
    expect(screen.queryByTestId('trip-map')).not.toBeInTheDocument()

    await advance(200_000)
    expect(callsTo('/api/trips', 'GET')).toHaveLength(24)
  })
})

describe('browser-local trip import, end to end', () => {
  const signIn = async (userId: string, importStatus: number) => {
    window.localStorage.setItem('trip-planner-trips', JSON.stringify(legacyTrips))
    const user = { id: userId, email: `${userId}@example.com`, isAdmin: false }
    let signedIn = false
    installBackend({
      '/api/ping': ok({ ok: true }),
      '/api/me': () =>
        signedIn ? { status: 200, body: { user } } : { status: 401, body: { error: 'Unauthorized' } },
      '/api/login': () => {
        signedIn = true
        return { status: 200, body: { user } }
      },
      '/api/trips': () => ({ status: 200, body: { trips: [], currentTripId: null } }),
      '/api/trips/import': () =>
        importStatus === 200
          ? { status: 200, body: { imported: ['old1'], skipped: [] } }
          : { status: importStatus, body: { error: 'boom' } },
      '/api/trip-selection': ok({ ok: true }),
    })
    renderApp()
    // Signed-out visitors land on the landing page first.
    await userEvent.click(await screen.findByRole('button', { name: 'Log in' }))
    await userEvent.type(await screen.findByLabelText('Email'), `${userId}@example.com`)
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  }

  it('success: POSTs the legacy trips to /api/trips/import, then local storage is cleared', async () => {
    await signIn('u-import-ok', 200)
    expect(await screen.findByTestId('trip-map')).toBeInTheDocument()

    const posts = callsTo('/api/trips/import', 'POST')
    expect(posts).toHaveLength(1)
    expect(JSON.parse((posts[0][1] as RequestInit).body as string)).toEqual({ trips: legacyTrips.trips })
    expect(window.localStorage.getItem('trip-planner-trips')).toBeNull()
    expect(screen.getByText(/imported 1 trip from this browser/i)).toBeInTheDocument()
  })

  it('failure: import rejected, local storage is NOT cleared and the user is told', async () => {
    await signIn('u-import-fail', 400)
    expect(await screen.findByTestId('trip-map')).toBeInTheDocument()

    await waitFor(() => expect(callsTo('/api/trips/import', 'POST')).toHaveLength(1))
    expect(JSON.parse(window.localStorage.getItem('trip-planner-trips') as string)).toEqual(legacyTrips)
    expect(screen.getByText(/could not be imported yet/i)).toBeInTheDocument()
  })
})
