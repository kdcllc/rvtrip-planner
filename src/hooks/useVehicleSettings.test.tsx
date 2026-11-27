import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { newVehicleId, useVehicleSettings } from './useVehicleSettings'
import { VEHICLES_MAX, VEHICLE_ID_PATTERN } from '../types/api'

const KEY = 'trip-planner:vehicleSettings'
const GARAGE_KEY = 'trip-planner:vehicleGarage'

describe('newVehicleId', () => {
  it('returns distinct ids matching the id pattern', () => {
    const a = newVehicleId()
    const b = newVehicleId()
    expect(a).toMatch(VEHICLE_ID_PATTERN)
    expect(b).toMatch(VEHICLE_ID_PATTERN)
    expect(a).not.toBe(b)
  })
})

describe('useVehicleSettings', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('returns one default vehicle when nothing is stored', () => {
    const { result } = renderHook(() => useVehicleSettings())
    expect(result.current.garage.vehicles).toHaveLength(1)
    expect(result.current.garage.defaultVehicleId).toBe(
      result.current.garage.vehicles[0].id
    )
    expect(result.current.profile).toEqual({
      name: '',
      fuelType: 'gasoline',
      mpg: 25,
      tankGallons: null,
    })
  })

  it('prefers a valid stored garage over the old key', () => {
    const garage = {
      vehicles: [
        { id: 'a', name: 'A', fuelType: 'diesel', mpg: 10, tankGallons: 50 },
        { id: 'b', name: 'B', fuelType: 'gasoline', mpg: 15, tankGallons: null },
      ],
      defaultVehicleId: 'b',
    }
    localStorage.setItem(GARAGE_KEY, JSON.stringify(garage))
    localStorage.setItem(KEY, JSON.stringify({ mpg: 30 }))
    const { result } = renderHook(() => useVehicleSettings())
    expect(result.current.garage).toEqual(garage)
    expect(result.current.mpg).toBe(15)
  })

  it('migrates the old single profile with a new id and leaves the old key', () => {
    const old = JSON.stringify({ name: '  Rig  ', mpg: 30, fuelType: 'diesel' })
    localStorage.setItem(KEY, old)
    const { result } = renderHook(() => useVehicleSettings())
    const [v] = result.current.garage.vehicles
    expect(result.current.garage.vehicles).toHaveLength(1)
    expect(v.id).toMatch(VEHICLE_ID_PATTERN)
    expect(v).toMatchObject({ name: 'Rig', mpg: 30, fuelType: 'diesel' })
    expect(localStorage.getItem(KEY)).toBe(old)
    expect(JSON.parse(localStorage.getItem(GARAGE_KEY) as string).vehicles).toHaveLength(1)
  })

  it('falls through corrupt garage JSON to the old key', () => {
    localStorage.setItem(GARAGE_KEY, '{nope')
    localStorage.setItem(KEY, JSON.stringify({ mpg: 18 }))
    const { result } = renderHook(() => useVehicleSettings())
    expect(result.current.mpg).toBe(18)
    expect(console.error).toHaveBeenCalled()
  })

  it('falls through an invalid garage and corrupt old JSON to defaults', () => {
    localStorage.setItem(GARAGE_KEY, JSON.stringify({ vehicles: [] }))
    localStorage.setItem(KEY, '{nope')
    const { result } = renderHook(() => useVehicleSettings())
    expect(result.current.garage.vehicles).toHaveLength(1)
    expect(result.current.mpg).toBe(25)
  })

  it('clamps and sanitises the migrated profile', () => {
    localStorage.setItem(KEY, JSON.stringify({ mpg: 500, tankGallons: 1000, fuelType: 'x' }))
    const { result } = renderHook(() => useVehicleSettings())
    expect(result.current.profile).toMatchObject({
      mpg: 100,
      tankGallons: null,
      fuelType: 'gasoline',
    })
  })

  it('keeps spaces on set but cuts the name to 80 characters', () => {
    const { result } = renderHook(() => useVehicleSettings())
    act(() => result.current.setProfile({ name: 'My ' }))
    expect(result.current.profile.name).toBe('My ')
    act(() => result.current.setProfile({ name: 'b'.repeat(120) }))
    expect(result.current.profile.name).toHaveLength(80)
  })

  it('persists the garage under the garage key only', () => {
    const { result } = renderHook(() => useVehicleSettings())
    act(() => result.current.setProfile({ name: 'Rig', fuelType: 'diesel', tankGallons: 60 }))
    const stored = JSON.parse(localStorage.getItem(GARAGE_KEY) as string)
    expect(stored.vehicles[0]).toMatchObject({
      name: 'Rig',
      fuelType: 'diesel',
      mpg: 25,
      tankGallons: 60,
    })
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('setMpg clamps and resetToDefault restores 25', () => {
    const { result } = renderHook(() => useVehicleSettings())
    act(() => result.current.setMpg(300))
    expect(result.current.mpg).toBe(100)
    act(() => result.current.resetToDefault())
    expect(result.current.mpg).toBe(25)
  })

  it('addVehicle returns a new id up to the max, then null', () => {
    const { result } = renderHook(() => useVehicleSettings())
    let id: string | null = null
    act(() => {
      id = result.current.addVehicle()
    })
    expect(id).toMatch(VEHICLE_ID_PATTERN)
    expect(result.current.garage.vehicles.map((v) => v.id)).toContain(id)
    for (let i = 2; i < VEHICLES_MAX; i++) {
      act(() => {
        result.current.addVehicle()
      })
    }
    expect(result.current.garage.vehicles).toHaveLength(VEHICLES_MAX)
    let extra: string | null = 'x'
    act(() => {
      extra = result.current.addVehicle()
    })
    expect(extra).toBeNull()
    expect(result.current.garage.vehicles).toHaveLength(VEHICLES_MAX)
  })

  it('update, setDefault and remove act on the garage; compat views follow the default', () => {
    const { result } = renderHook(() => useVehicleSettings())
    const firstId = result.current.garage.vehicles[0].id
    let second: string | null = null
    act(() => {
      second = result.current.addVehicle()
    })
    act(() => result.current.updateVehicle(second as unknown as string, { name: 'Second', mpg: 9 }))
    expect(result.current.mpg).toBe(25)
    act(() => result.current.setDefaultVehicle(second as unknown as string))
    expect(result.current.mpg).toBe(9)
    expect(result.current.profile.name).toBe('Second')
    act(() => result.current.removeVehicle(second as unknown as string))
    expect(result.current.garage.defaultVehicleId).toBe(firstId)
    act(() => result.current.removeVehicle(firstId))
    expect(result.current.garage.vehicles).toHaveLength(1)
  })

  it('replaceGarage sanitises and ignores an unusable garage', () => {
    const { result } = renderHook(() => useVehicleSettings())
    const before = result.current.garage
    act(() => result.current.replaceGarage({ vehicles: [], defaultVehicleId: 'x' }))
    expect(result.current.garage).toBe(before)
    act(() =>
      result.current.replaceGarage({
        vehicles: [{ id: 'z', name: 'Z', fuelType: 'diesel', mpg: 500, tankGallons: null }],
        defaultVehicleId: 'nope',
      })
    )
    expect(result.current.garage.defaultVehicleId).toBe('z')
    expect(result.current.mpg).toBe(100)
  })
})
