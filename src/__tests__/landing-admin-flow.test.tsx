// Cross-task client flows: landing -> request an invite -> register link prefill -> admin panel.
// Only the transport (fetchWithBackoff) and heavy map/form widgets are stubbed; the invite,
// admin, auth and storage service layers, AuthProvider and App wiring are real.
import { forwardRef } from 'react'
import { render, screen, within } from '@testing-library/react'
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
  useVehicleSettingsContext: () => ({ debouncedMpg: 10 }),
}))
vi.mock('../hooks/useRoutesEnabled', () => ({ useRoutesEnabled: () => [false] }))
vi.mock('../services/print/printTripPdf', () => ({ downloadTripPdf: vi.fn() }))
vi.mock('../services/gas/gasPriceService', () => ({
  gasPriceService: { getPriceForState: vi.fn() },
}))

import App from '../app/App'
import { AuthProvider } from '../hooks/AuthProvider'

type Handler = (method: string, body: unknown) => { status: number; body?: unknown }

const respond = (r: ReturnType<Handler>) =>
  new Response(r.body === undefined ? null : JSON.stringify(r.body), {
    status: r.status,
    headers: { 'Content-Type': 'application/json' },
  })

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

const ok = (body: unknown): Handler => () => ({ status: 200, body })
const signedOut: Handler = () => ({ status: 401, body: { error: 'Unauthorized' } })

const renderApp = () =>
  render(
    <AuthProvider>
      <App />
    </AuthProvider>,
  )

const setUrl = (url: string) => window.history.replaceState(null, '', url)

beforeEach(() => {
  h.fetch.mockReset()
  window.localStorage.clear()
  document.cookie = 'csrf_token=tok; path=/'
  setUrl('/')
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
  setUrl('/')
  document.cookie = 'csrf_token=; Max-Age=0; path=/'
})

describe('signed-out landing flow', () => {
  it('shows the landing page and submitting Request an invite POSTs the form and shows the success message', async () => {
    installBackend({
      '/api/ping': ok({ ok: true }),
      '/api/me': signedOut,
      '/api/invite-requests': ok({ ok: true }),
    })
    renderApp()

    expect(await screen.findByRole('heading', { level: 1, name: /plan your next rv road trip/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument()
    expect(callsTo('/api/invite-requests')).toHaveLength(0)

    const form = screen.getByRole('form', { name: 'Request an invite' })
    await userEvent.type(within(form).getByLabelText('Name'), 'Dana Driver')
    await userEvent.type(within(form).getByLabelText('Email'), 'dana@example.com')
    await userEvent.type(within(form).getByLabelText(/Note/), 'Full-timer')
    await userEvent.click(within(form).getByRole('button', { name: 'Request an invite' }))

    expect(await screen.findByText(/we'll email you when your invite is ready/i)).toBeInTheDocument()
    const posts = callsTo('/api/invite-requests', 'POST')
    expect(posts).toHaveLength(1)
    expect(JSON.parse((posts[0][1] as RequestInit).body as string)).toMatchObject({
      email: 'dana@example.com',
      name: 'Dana Driver',
      note: 'Full-timer',
    })
  })

  it('invalid input is rejected client-side and nothing is sent', async () => {
    installBackend({ '/api/ping': ok({ ok: true }), '/api/me': signedOut, '/api/invite-requests': ok({ ok: true }) })
    renderApp()
    const form = await screen.findByRole('form', { name: 'Request an invite' })
    await userEvent.type(within(form).getByLabelText('Name'), 'Dana')
    await userEvent.type(within(form).getByLabelText('Email'), 'not-an-email')
    await userEvent.click(within(form).getByRole('button', { name: 'Request an invite' }))
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0)
    expect(callsTo('/api/invite-requests')).toHaveLength(0)
    expect(screen.queryByText(/we'll email you/i)).not.toBeInTheDocument()
  })

  it('?invite=XYZ skips the landing page, opens register with the code pre-filled and strips it from the URL', async () => {
    setUrl('/?invite=XYZ-123')
    installBackend({ '/api/ping': ok({ ok: true }), '/api/me': signedOut })
    renderApp()

    expect(await screen.findByLabelText('Invite code')).toHaveValue('XYZ-123')
    expect(screen.queryByRole('heading', { level: 1, name: /plan your next rv road trip/i })).not.toBeInTheDocument()
    expect(window.location.search).not.toContain('invite')
  })
})

describe('admin flow', () => {
  const pending = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'dana@example.com',
    name: 'Dana Driver',
    note: null,
    status: 'pending',
    createdAt: '2026-03-01T12:00:00.000Z',
    invitedAt: null,
    inviteCount: 0,
  }

  const signInAs = (isAdmin: boolean) =>
    installBackend({
      '/api/ping': ok({ ok: true }),
      '/api/me': ok({ user: { id: 'u1', email: isAdmin ? 'admin@example.com' : 'u@example.com', isAdmin } }),
      '/api/trips': ok({ trips: [], currentTripId: null }),
      '/api/manage/invite-requests': ok({ requests: [pending] }),
      [`/api/manage/invite-requests/${pending.id}/invite`]: ok({
        request: { ...pending, status: 'invited', invitedAt: '2026-03-02T09:00:00.000Z', inviteCount: 1 },
      }),
    })

  it('an admin sees Access requests, lists the request and sends an invite', async () => {
    signInAs(true)
    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: 'Access requests' }))
    const dialog = await screen.findByRole('dialog', { name: 'Access requests' })
    expect(await within(dialog).findByText('dana@example.com')).toBeInTheDocument()
    expect(callsTo('/api/manage/invite-requests', 'GET')).toHaveLength(1)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }))

    // The default filter is Pending, so the invited row leaves it...
    expect(await within(dialog).findByText('No pending requests')).toBeInTheDocument()
    const posts = callsTo(`/api/manage/invite-requests/${pending.id}/invite`, 'POST')
    expect(posts).toHaveLength(1)
    expect(screen.getByText('Invite sent to dana@example.com')).toBeInTheDocument()
    // ...and shows under Invited with a Resend action and the updated count.
    await userEvent.click(within(dialog).getByRole('button', { name: /^Invited \(1\)/ }))
    expect(within(dialog).getByRole('button', { name: 'Resend' })).toBeInTheDocument()
    expect(within(dialog).getByText('invited')).toBeInTheDocument()
    expect(within(dialog).getByText(/×1/)).toBeInTheDocument()
  })

  it('a non-admin never sees Access requests and no admin endpoint is called', async () => {
    signInAs(false)
    renderApp()
    expect(await screen.findByTestId('trip-map')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Access requests' })).not.toBeInTheDocument()
    expect(callsTo('/api/manage/invite-requests')).toHaveLength(0)
  })
})
