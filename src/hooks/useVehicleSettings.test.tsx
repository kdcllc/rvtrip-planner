import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVehicleSettings } from './useVehicleSettings'

const KEY = 'trip-planner:vehicleSettings'

describe('useVehicleSettings', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('returns defaults when nothing is stored', () => {
    const { result } = renderHook(() => useVehicleSettings())
    expect(result.current.profile).toEqual({
      name: '',
      fuelType: 'gasoline',
      mpg: 25,
      tankGallons: null,
    })
  })

  it('reads a legacy { mpg } value as defaults plus that mpg', () => {
    localStorage.setItem(KEY, JSON.stringify({ mpg: 30 }))
    const { result } = renderHook(() => useVehicleSettings())
    expect(result.current.profile).toEqual({
      name: '',
      fuelType: 'gasoline',
      mpg: 30,
      tankGallons: null,
    })
  })

  it('clamps mpg to 5..100 on read', () => {
    localStorage.setItem(KEY, JSON.stringify({ mpg: 500 }))
    expect(renderHook(() => useVehicleSettings()).result.current.mpg).toBe(100)
    localStorage.setItem(KEY, JSON.stringify({ mpg: 1 }))
    expect(renderHook(() => useVehicleSettings()).result.current.mpg).toBe(5)
  })

  it('turns an out-of-range tank into null', () => {
    localStorage.setItem(KEY, JSON.stringify({ mpg: 10, tankGallons: 1000 }))
    expect(
      renderHook(() => useVehicleSettings()).result.current.profile.tankGallons
    ).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ mpg: 10, tankGallons: 80 }))
    expect(
      renderHook(() => useVehicleSettings()).result.current.profile.tankGallons
    ).toBe(80)
  })

  it('trims the stored name and cuts it to 80 characters', () => {
    localStorage.setItem(KEY, JSON.stringify({ name: `  ${'a'.repeat(100)}  ` }))
    const { result } = renderHook(() => useVehicleSettings())
    expect(result.current.profile.name).toBe('a'.repeat(80))
  })

  it('turns an unknown fuel type into gasoline', () => {
    localStorage.setItem(KEY, JSON.stringify({ fuelType: 'hydrogen', mpg: 12 }))
    const { result } = renderHook(() => useVehicleSettings())
    expect(result.current.profile.fuelType).toBe('gasoline')
  })

  it('keeps surrounding spaces on set but cuts to 80 characters', () => {
    const { result } = renderHook(() => useVehicleSettings())
    act(() => result.current.setProfile({ name: 'My ' }))
    expect(result.current.profile.name).toBe('My ')
    act(() => result.current.setProfile({ name: 'b'.repeat(120) }))
    expect(result.current.profile.name).toHaveLength(80)
  })

  it('persists the patched profile under the settings key', () => {
    const { result } = renderHook(() => useVehicleSettings())
    act(() =>
      result.current.setProfile({ name: 'Rig', fuelType: 'diesel', tankGallons: 60 })
    )
    expect(JSON.parse(localStorage.getItem(KEY) as string)).toEqual({
      name: 'Rig',
      fuelType: 'diesel',
      mpg: 25,
      tankGallons: 60,
    })
  })

  it('setMpg clamps and resetToDefault restores 25', () => {
    const { result } = renderHook(() => useVehicleSettings())
    act(() => result.current.setMpg(300))
    expect(result.current.mpg).toBe(100)
    act(() => result.current.resetToDefault())
    expect(result.current.mpg).toBe(25)
  })
})
