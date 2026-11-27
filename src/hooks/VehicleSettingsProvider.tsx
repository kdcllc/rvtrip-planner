import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { getDefaultVehicle } from '../domain/vehicle/garage'
import {
  VehicleSettingsContext,
  type ProfileSyncStatus,
  useVehicleSettings,
} from './useVehicleSettings'

type VehicleSettingsProviderProps = {
  children: ReactNode
  initialMpg?: number
  debounceMs?: number
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedValue(value)
    }, delayMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [value, delayMs])

  return debouncedValue
}

export const VehicleSettingsProvider = ({
  children,
  initialMpg,
  debounceMs = 300,
}: VehicleSettingsProviderProps) => {
  const {
    garage,
    addVehicle,
    updateVehicle,
    removeVehicle,
    setDefaultVehicle,
    replaceGarage,
    mpg,
    setMpg,
    resetToDefault,
    profile,
    setProfile,
  } = useVehicleSettings(initialMpg)
  const debouncedGarage = useDebouncedValue(garage, debounceMs)
  const [profileSyncStatus, setProfileSyncStatus] =
    useState<ProfileSyncStatus>('local')

  const debouncedProfile = useMemo(() => {
    const { name, fuelType, mpg: m, tankGallons } =
      getDefaultVehicle(debouncedGarage)
    return { name, fuelType, mpg: m, tankGallons }
  }, [debouncedGarage])
  const debouncedMpg = debouncedProfile.mpg

  const value = useMemo(
    () => ({
      garage,
      debouncedGarage,
      addVehicle,
      updateVehicle,
      removeVehicle,
      setDefaultVehicle,
      replaceGarage,
      mpg,
      debouncedMpg,
      setMpg,
      resetToDefault,
      profile,
      debouncedProfile,
      setProfile,
      profileSyncStatus,
      setProfileSyncStatus,
    }),
    [
      garage,
      debouncedGarage,
      addVehicle,
      updateVehicle,
      removeVehicle,
      setDefaultVehicle,
      replaceGarage,
      mpg,
      debouncedMpg,
      setMpg,
      resetToDefault,
      profile,
      debouncedProfile,
      setProfile,
      profileSyncStatus,
    ]
  )

  return (
    <VehicleSettingsContext.Provider value={value}>
      {children}
    </VehicleSettingsContext.Provider>
  )
}
