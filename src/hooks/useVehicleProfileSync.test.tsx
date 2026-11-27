import type { ReactNode } from 'react'
import { renderHook, act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VehicleSettingsProvider } from './VehicleSettingsProvider'
import { useVehicleSettingsContext } from './useVehicleSettings'
import { useVehicleProfileSync } from './useVehicleProfileSync'
import type { VehicleProfile } from '../types/api'

const loadVehicleProfile = vi.hoisted(() => vi.fn())
const saveVehicleProfile = vi.hoisted(() => vi.fn())

vi.mock('../services/vehicle/vehicleProfileClient', () => ({
  loadVehicleProfile,
  saveVehicleProfile,
}))

const server: VehicleProfile = {
  name: 'Server RV',
  fuelType: 'diesel',
  mpg: 12,
  tankGallons: 90,
}

const ok = (profile: VehicleProfile | null) => ({
  kind: 'success' as const,
  status: 200,
  data: { profile },
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
    loadVehicleProfile.mockReset()
    saveVehicleProfile.mockReset()
    saveVehicleProfile.mockImplementation(async (p: VehicleProfile) => ok(p))
  })

  it('replaces the local profile with the server profile and does not re-save it', async () => {
    loadVehicleProfile.mockResolvedValue(ok(server))
    const { result } = setup()
    expect(result.current.profileSyncStatus).toBe('loading')
    await waitFor(() => expect(result.current.profileSyncStatus).toBe('synced'))
    expect(result.current.profile).toEqual(server)
    await waitFor(() => expect(result.current.debouncedProfile).toEqual(server))
    await new Promise((r) => setTimeout(r, 30))
    expect(saveVehicleProfile).not.toHaveBeenCalled()
  })

  it('saves the local profile once when the server has none', async () => {
    localStorage.setItem('trip-planner:vehicleSettings', JSON.stringify({ mpg: 18 }))
    loadVehicleProfile.mockResolvedValue(ok(null))
    const { result } = setup()
    await waitFor(() => expect(result.current.profileSyncStatus).toBe('synced'))
    expect(saveVehicleProfile).toHaveBeenCalledTimes(1)
    expect(saveVehicleProfile).toHaveBeenCalledWith(
      expect.objectContaining({ mpg: 18, fuelType: 'gasoline' })
    )
    await new Promise((r) => setTimeout(r, 30))
    expect(saveVehicleProfile).toHaveBeenCalledTimes(1)
  })

  it('sets error when the load fails and keeps local values', async () => {
    loadVehicleProfile.mockResolvedValue(fail)
    const { result } = setup()
    await waitFor(() => expect(result.current.profileSyncStatus).toBe('error'))
    expect(result.current.mpg).toBe(25)
    expect(saveVehicleProfile).not.toHaveBeenCalled()
  })

  it('saves a later profile change once after the debounce', async () => {
    loadVehicleProfile.mockResolvedValue(ok(server))
    const { result } = setup()
    await waitFor(() => expect(result.current.profileSyncStatus).toBe('synced'))
    act(() => result.current.setProfile({ name: 'Renamed' }))
    await waitFor(() => expect(saveVehicleProfile).toHaveBeenCalledTimes(1))
    expect(saveVehicleProfile).toHaveBeenCalledWith({ ...server, name: 'Renamed' })
    await waitFor(() => expect(result.current.profileSyncStatus).toBe('synced'))
    await new Promise((r) => setTimeout(r, 30))
    expect(saveVehicleProfile).toHaveBeenCalledTimes(1)
  })

  it('retries the load (not the save) after a failed load, and server wins', async () => {
    loadVehicleProfile.mockResolvedValueOnce(fail).mockResolvedValueOnce(ok(server))
    const { result } = setup()
    await waitFor(() => expect(result.current.profileSyncStatus).toBe('error'))
    act(() => result.current.setProfile({ name: 'Local edit' }))
    await waitFor(() => expect(loadVehicleProfile).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.profileSyncStatus).toBe('synced'))
    expect(result.current.profile).toEqual(server)
    expect(saveVehicleProfile).not.toHaveBeenCalled()
  })

  it('sets error when a save fails and retries on the next change', async () => {
    loadVehicleProfile.mockResolvedValue(ok(server))
    saveVehicleProfile.mockResolvedValueOnce(fail)
    const { result } = setup()
    await waitFor(() => expect(result.current.profileSyncStatus).toBe('synced'))
    act(() => result.current.setProfile({ mpg: 14 }))
    await waitFor(() => expect(result.current.profileSyncStatus).toBe('error'))
    act(() => result.current.setProfile({ mpg: 15 }))
    await waitFor(() => expect(result.current.profileSyncStatus).toBe('synced'))
    expect(saveVehicleProfile).toHaveBeenCalledTimes(2)
  })
})
