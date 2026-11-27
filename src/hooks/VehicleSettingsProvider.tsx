import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
  const { mpg, setMpg, resetToDefault, profile, setProfile, replaceProfile } =
    useVehicleSettings(initialMpg)
  const debouncedMpg = useDebouncedValue(mpg, debounceMs)
  const debouncedProfile = useDebouncedValue(profile, debounceMs)
  const [profileSyncStatus, setProfileSyncStatus] =
    useState<ProfileSyncStatus>('local')

  const value = useMemo(
    () => ({
      mpg,
      debouncedMpg,
      setMpg,
      resetToDefault,
      profile,
      debouncedProfile,
      setProfile,
      replaceProfile,
      profileSyncStatus,
      setProfileSyncStatus,
    }),
    [
      mpg,
      debouncedMpg,
      setMpg,
      resetToDefault,
      profile,
      debouncedProfile,
      setProfile,
      replaceProfile,
      profileSyncStatus,
    ]
  )

  return (
    <VehicleSettingsContext.Provider value={value}>
      {children}
    </VehicleSettingsContext.Provider>
  )
}
