import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_VERSION } from '../config/version'
import { fetchDeployedVersion } from '../services/version/versionCheck'
import { useVersionCheck } from './useVersionCheck'

vi.mock('../services/version/versionCheck', async (orig) => ({
  ...(await orig<typeof import('../services/version/versionCheck')>()),
  fetchDeployedVersion: vi.fn(),
}))

const fetchMock = vi.mocked(fetchDeployedVersion)
const INTERVAL = 1000
const same = { ...APP_VERSION }
const newer = { ...APP_VERSION, version: '9.9.9' }

const opts = { enabled: true, intervalMs: INTERVAL }
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('useVersionCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(same)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('checks on mount', async () => {
    renderHook(() => useVersionCheck(opts))
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-checks after the interval', async () => {
    renderHook(() => useVersionCheck(opts))
    await flush()
    await advance(INTERVAL)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await advance(INTERVAL)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('re-checks on visibilitychange when visible', async () => {
    renderHook(() => useVersionCheck(opts))
    await flush()
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('ignores visibilitychange when hidden', async () => {
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    renderHook(() => useVersionCheck(opts))
    await flush()
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('re-checks on focus', async () => {
    renderHook(() => useVersionCheck(opts))
    await flush()
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('sets updateAvailable and stops polling on a new version', async () => {
    fetchMock.mockResolvedValue(newer)
    const { result } = renderHook(() => useVersionCheck(opts))
    expect(result.current.updateAvailable).toBe(false)
    await flush()
    expect(result.current.updateAvailable).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await advance(INTERVAL * 3)
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps polling when the result is null', async () => {
    fetchMock.mockResolvedValue(null)
    const { result } = renderHook(() => useVersionCheck(opts))
    await flush()
    await advance(INTERVAL)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.updateAvailable).toBe(false)
  })

  it('makes zero fetch calls when disabled', async () => {
    renderHook(() => useVersionCheck({ enabled: false, intervalMs: INTERVAL }))
    await flush()
    await advance(INTERVAL * 3)
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('removes listeners and timer on unmount', async () => {
    const { unmount } = renderHook(() => useVersionCheck(opts))
    await flush()
    unmount()
    await advance(INTERVAL * 3)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reload calls window.location.reload', () => {
    const reload = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload },
    })
    try {
      const { result } = renderHook(() => useVersionCheck({ enabled: false }))
      result.current.reload()
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
  })
})
