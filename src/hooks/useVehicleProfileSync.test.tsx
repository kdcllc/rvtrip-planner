import type { ReactNode } from 'react'
import { renderHook, act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VehicleSettingsProvider } from './VehicleSettingsProvider'
import { useVehicleSettingsContext } from './useVehicleSettings'
import { useVehicleProfileSync } from './useVehicleProfileSync'
import type { VehicleGarage } from '../types/api'

const loadVehicleGarage = vi.hoisted(() => vi.fn())
const saveVehicleGarage = vi.hoisted(() => vi.fn())

vi.mock('../services/vehicle/vehiclesClient', () => ({
  loadVehicleGarage,
  saveVehicleGarage,
}))

const serverVehicle = {
  id: 'srv-1',
  name: 'Server RV',
  fuelType: 'diesel' as const,
  mpg: 12,
  tankGallons: 90,
}
const server: VehicleGarage = {
  vehicles: [serverVehicle],
  defaultVehicleId: 'srv-1',
}

const ok = (garage: VehicleGarage | null) => ({
  kind: 'success' as const,
  status: 200,
  data: { garage },
})
const fail = { kind: 'error' as const, status: 500, error: 'boom' }

const wrapper = ({ children }: { children: ReactNode }) => (
  <VehicleSettingsProvider debounceMs={10}>{children}</VehicleSettingsProvider>
)

const setup = () =>
  renderHook(
    () => {
      useVehicleProfileSync()
      return useVehicleSettingsContext()
    },
    { wrapper }
  )

describe('useVehicleProfileSync', () => {
  beforeEach(() => {
    localStorage.clear()
    loadVehicleGarage.mockReset()
    saveVehicleGarage.mockReset()
    saveVehicleGarage.mockImplementation(async (g: VehicleGarage) => ok(g))
  })

  it('replaces the local garage with the server profile and does not re-save it', async () => {
    loadVehicleGarage.mockResolvedValue(ok(server))
    const { result } = setup()
    expect(result.current.profileSyncStatus).toBe('loading')
    await waitFor(() => expect(result.current.profileSyncStatus).toBe('synced'))
    expect(result.current.garage).toEqual(server)
    await waitFor(() => expect(result.current.debouncedGarage).toEqual(server))
    await new Promise((r) => setTimeout(r, 30))
    expect(saveVehicleGarage).not.toHaveBeenCalled()
  })

  it('saves the local garage once when the server has none', async () => {
    localStorage.setItem('trip-planner:vehicleSettings', JSON.stringify({ mpg: 18 }))
    loadVehicleGarage.mockResolvedValue(ok(null))
    const { result } = setup()
    await waitFor(() => expect(result.current.profileSyncStatus).toBe('synced'))
    expect(saveVehicleGarage).toHaveBeenCalledTimes(1)
    expect(saveVehicleGarage).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicles: [expect.objectContaining({ mpg: 18, fuelType: 'gasoline' })],
      })
    )
    await new Promise((r) => setTimeout(r, 30))
    expect(saveVehicleGarage).toHaveBeenCalledTimes(1)
  })

  it('sets error when the load fails and keeps local values', async () => {
    loadVehicleGarage.mockResolvedValue(fail)
    const { result } = setup()
    await waitFor(() => expect(result.current.profileSyncStatus).toBe('error'))
    expect(result.current.mpg).toBe(25)
    expect(saveVehicleGarage).not.toHaveBeenCalled()
  })

  it('saves a later garage change once after the debounce', async () => {
    loadVehicleGarage.mockResolvedValue(ok(server))
    const { result } = setup()
    await waitFor(() => expect(result.current.profileSyncStatus).toBe('synced'))
    act(() => result.current.setProfile({ name: 'Renamed' }))
    await waitFor(() => expect(saveVehicleGarage).toHaveBeenCalledTimes(1))
    expect(saveVehicleGarage).toHaveBeenCalledWith({
      ...server,
      vehicles: [{ ...serverVehicle, name: 'Renamed' }],
    })
    await waitFor(() => expect(result.current.profileSyncStatus).toBe('synced'))
    await new Promise((r) => setTimeout(r, 30))
    expect(saveVehicleGarage).toHaveBeenCalledTimes(1)
  })

  it('retries the load (not the save) after a failed load, and server wins', async () => {
    loadVehicleGarage.mockResolvedValueOnce(fail).mockResolvedValueOnce(ok(server))
    const { result } = setup()
    await waitFor(() => expect(result.current.profileSyncStatus).toBe('error'))
    act(() => result.current.setProfile({ name: 'Local edit' }))
    await waitFor(() => expect(loadVehicleGarage).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.profileSyncStatus).toBe('synced'))
    expect(result.current.garage).toEqual(server)
    expect(saveVehicleGarage).not.toHaveBeenCalled()
  })

  it('sets error when a save fails and retries on the next change', async () => {
    loadVehicleGarage.mockResolvedValue(ok(server))
    saveVehicleGarage.mockResolvedValueOnce(fail)
    const { result } = setup()
    await waitFor(() => expect(result.current.profileSyncStatus).toBe('synced'))
    act(() => result.current.setProfile({ mpg: 14 }))
    await waitFor(() => expect(result.current.profileSyncStatus).toBe('error'))
    act(() => result.current.setProfile({ mpg: 15 }))
    await waitFor(() => expect(result.current.profileSyncStatus).toBe('synced'))
    expect(saveVehicleGarage).toHaveBeenCalledTimes(2)
  })
})
