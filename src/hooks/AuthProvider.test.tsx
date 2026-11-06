import { act, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as authClient from '../services/auth/authClient'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './useAuth'

vi.mock('../services/auth/authClient')

const mocked = vi.mocked(authClient)

function Probe() {
  const { status, user } = useAuth()
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.email ?? 'none'}</span>
    </div>
  )
}

const renderProvider = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  )

describe('AuthProvider', () => {
  beforeEach(() => {
    mocked.ping.mockResolvedValue({ kind: 'success', status: 200, data: { ok: true } })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.resetAllMocks()
  })

  it('pings on mount and resolves an authenticated session', async () => {
    mocked.getCurrentUser.mockResolvedValue({
      kind: 'success',
      status: 200,
      data: { user: { id: 'u1', email: 'a@b.co', isAdmin: false } },
    })
    renderProvider()
    expect(screen.getByTestId('status')).toHaveTextContent('checking')
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    expect(mocked.ping).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('user')).toHaveTextContent('a@b.co')
  })

  it('401 from getCurrentUser leaves unauthenticated with no user', async () => {
    mocked.getCurrentUser.mockResolvedValue({ kind: 'auth-failure', status: 401, error: 'no' })
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(screen.getByTestId('user')).toHaveTextContent('none')
  })

  it('503 shows databaseWaking and retries a bounded number of times, then settles', async () => {
    vi.useFakeTimers()
    mocked.getCurrentUser.mockResolvedValue({
      kind: 'database-waking',
      status: 503,
      retryAfterSeconds: 1,
    })
    renderProvider()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByTestId('status')).toHaveTextContent('databaseWaking')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(mocked.getCurrentUser).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
  })

  it('worst-case waking window is bounded: one outer retry after <= 1s, nothing after', async () => {
    vi.useFakeTimers()
    mocked.getCurrentUser.mockResolvedValue({ kind: 'database-waking', status: 503, retryAfterSeconds: 60 })
    renderProvider()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mocked.getCurrentUser).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(mocked.getCurrentUser).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(mocked.getCurrentUser).toHaveBeenCalledTimes(2)
  })

  it('StrictMode double-mount leaves no stray retry chain', async () => {
    vi.useFakeTimers()
    mocked.getCurrentUser.mockResolvedValue({ kind: 'database-waking', status: 503, retryAfterSeconds: 1 })
    render(
      <StrictMode>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </StrictMode>
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    // Two mounts x (1 initial + 1 retry) = 4 at most; the first mount's chain must be dead (<= 3).
    expect(mocked.getCurrentUser.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('useAuth throws a descriptive error outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<Probe />)).toThrow('useAuth must be used within an AuthProvider')
    spy.mockRestore()
  })
})
