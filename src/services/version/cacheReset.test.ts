import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_VERSION_STORAGE_KEY, resetCachesOnVersionChange } from './cacheReset'

const current = { version: '2.0.0', commit: 'abc', buildTime: 'x' }
const CACHE_KEYS = [
  'tripPlanner.routes.cache.v1',
  'tripPlanner.geocode.cache.v1',
  'tripPlanner.weather.cache.v1',
]
const USER_KEYS = [
  'trip-planner-trips',
  'exported-trips',
  'trip-planner:vehicleSettings',
  'trip-planner-theme',
]

function seed(withVersion?: string) {
  localStorage.clear()
  CACHE_KEYS.forEach((k) => localStorage.setItem(k, 'c'))
  USER_KEYS.forEach((k) => localStorage.setItem(k, 'u'))
  if (withVersion) localStorage.setItem(APP_VERSION_STORAGE_KEY, withVersion)
}

describe('resetCachesOnVersionChange', () => {
  beforeEach(() => localStorage.clear())

  it('first run removes cache keys, stores version, returns true', () => {
    seed()
    expect(resetCachesOnVersionChange(current, localStorage)).toBe(true)
    CACHE_KEYS.forEach((k) => expect(localStorage.getItem(k)).toBeNull())
    expect(localStorage.getItem(APP_VERSION_STORAGE_KEY)).not.toBeNull()
    expect(localStorage.getItem(APP_VERSION_STORAGE_KEY)).toContain('2.0.0')
  })

  it('same version returns false and removes nothing', () => {
    seed()
    resetCachesOnVersionChange(current, localStorage)
    CACHE_KEYS.forEach((k) => localStorage.setItem(k, 'again'))
    expect(resetCachesOnVersionChange(current, localStorage)).toBe(false)
    CACHE_KEYS.forEach((k) => expect(localStorage.getItem(k)).toBe('again'))
  })

  it('a changed version clears caches again', () => {
    seed()
    resetCachesOnVersionChange(current, localStorage)
    CACHE_KEYS.forEach((k) => localStorage.setItem(k, 'again'))
    expect(resetCachesOnVersionChange({ ...current, commit: 'def' }, localStorage)).toBe(true)
    CACHE_KEYS.forEach((k) => expect(localStorage.getItem(k)).toBeNull())
  })

  it('user keys always survive', () => {
    seed()
    resetCachesOnVersionChange(current, localStorage)
    USER_KEYS.forEach((k) => expect(localStorage.getItem(k)).toBe('u'))
    resetCachesOnVersionChange({ ...current, version: '3.0.0' }, localStorage)
    USER_KEYS.forEach((k) => expect(localStorage.getItem(k)).toBe('u'))
  })

  it('uses global localStorage when no storage is passed', () => {
    seed()
    expect(resetCachesOnVersionChange(current)).toBe(true)
    CACHE_KEYS.forEach((k) => expect(localStorage.getItem(k)).toBeNull())
  })

  it('returns false without throwing when storage throws', () => {
    const bad = {
      length: 0,
      getItem: vi.fn(() => {
        throw new Error('denied')
      }),
      key: vi.fn(),
      removeItem: vi.fn(),
      setItem: vi.fn(),
      clear: vi.fn(),
    } as unknown as Storage
    expect(() => resetCachesOnVersionChange(current, bad)).not.toThrow()
    expect(resetCachesOnVersionChange(current, bad)).toBe(false)
  })
})
