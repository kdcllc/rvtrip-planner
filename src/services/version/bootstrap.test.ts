import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('bootstrap', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('resets caches once on import and keeps user data', async () => {
    localStorage.setItem('tripPlanner.routes.cache.v1', 'c')
    localStorage.setItem('trip-planner-trips', 'u')

    await import('./bootstrap')

    expect(localStorage.getItem('tripPlanner.routes.cache.v1')).toBeNull()
    expect(localStorage.getItem('trip-planner-trips')).toBe('u')
    expect(localStorage.getItem('tripPlanner.appVersion')).not.toBeNull()

    localStorage.setItem('tripPlanner.routes.cache.v1', 'again')
    await import('./bootstrap')
    expect(localStorage.getItem('tripPlanner.routes.cache.v1')).toBe('again')
  })
})
