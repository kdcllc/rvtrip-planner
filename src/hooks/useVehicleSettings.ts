import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useContext,
  createContext,
} from 'react'
import {
  DEFAULT_MPG,
  addVehicle as addVehicleToGarage,
  createVehicle,
  garageFromProfile,
  getDefaultVehicle,
  removeVehicle as removeVehicleFromGarage,
  sanitizeGarage,
  sanitizeVehicleProfile,
  setDefaultVehicle as setDefaultVehicleInGarage,
  updateVehicle as updateVehicleInGarage,
} from '../domain/vehicle/garage'
import { VEHICLES_MAX, type VehicleGarage, type VehicleProfile } from '../types/api'

const VEHICLE_SETTINGS_KEY = 'trip-planner:vehicleSettings'
const VEHICLE_GARAGE_KEY = 'trip-planner:vehicleGarage'

export type VehicleSettings = VehicleProfile

export type ProfileSyncStatus = 'local' | 'loading' | 'synced' | 'error'

export type VehicleSettingsContextValue = {
  garage: VehicleGarage
  debouncedGarage: VehicleGarage
  addVehicle: () => string | null
  updateVehicle: (id: string, patch: Partial<VehicleProfile>) => void
  removeVehicle: (id: string) => void
  setDefaultVehicle: (id: string) => void
  replaceGarage: (garage: VehicleGarage) => void
  // Default-vehicle compatibility views
  mpg: number
  debouncedMpg: number
  setMpg: (mpg: number) => void
  resetToDefault: () => void
  profile: VehicleProfile
  debouncedProfile: VehicleProfile
  setProfile: (patch: Partial<VehicleProfile>) => void
  profileSyncStatus: ProfileSyncStatus
  setProfileSyncStatus: (status: ProfileSyncStatus) => void
}

export const VehicleSettingsContext =
  createContext<VehicleSettingsContextValue | null>(null)

/** The only vehicle id generator. */
export const newVehicleId = (): string => crypto.randomUUID()

const readGarage = (fallbackMpg: number): VehicleGarage => {
  try {
    const stored = localStorage.getItem(VEHICLE_GARAGE_KEY)
    if (stored) {
      const garage = sanitizeGarage(JSON.parse(stored))
      if (garage) return garage
    }
  } catch (error) {
    console.error('Failed to parse vehicle garage from localStorage:', error)
  }
  try {
    const legacy = localStorage.getItem(VEHICLE_SETTINGS_KEY)
    if (legacy) {
      const parsed = JSON.parse(legacy) as Partial<
        Record<keyof VehicleProfile, unknown>
      > | null
      return garageFromProfile(
        sanitizeVehicleProfile(parsed, fallbackMpg, true),
        newVehicleId()
      )
    }
  } catch (error) {
    console.error('Failed to parse vehicle settings from localStorage:', error)
  }
  return garageFromProfile(
    sanitizeVehicleProfile(null, fallbackMpg, true),
    newVehicleId()
  )
}

/**
 * Hook to persist and manage the vehicle garage. Reads from localStorage on
 * mount (migrating the old single profile once), persists changes immediately.
 */
export const useVehicleSettings = (initialMpg?: number) => {
  const [garage, setGarage] = useState<VehicleGarage>(() =>
    readGarage(initialMpg ?? DEFAULT_MPG)
  )

  useEffect(() => {
    try {
      localStorage.setItem(VEHICLE_GARAGE_KEY, JSON.stringify(garage))
    } catch (error) {
      console.error('Failed to persist vehicle garage to localStorage:', error)
    }
  }, [garage])

  const addVehicle = useCallback((): string | null => {
    if (garage.vehicles.length >= VEHICLES_MAX) return null
    const id = newVehicleId()
    setGarage((current) => addVehicleToGarage(current, createVehicle(id)))
    return id
  }, [garage.vehicles.length])

  const updateVehicle = useCallback(
    (id: string, patch: Partial<VehicleProfile>) => {
      setGarage((current) => updateVehicleInGarage(current, id, patch))
    },
    []
  )

  const removeVehicle = useCallback((id: string) => {
    setGarage((current) => removeVehicleFromGarage(current, id))
  }, [])

  const setDefaultVehicle = useCallback((id: string) => {
    setGarage((current) => setDefaultVehicleInGarage(current, id))
  }, [])

  const replaceGarage = useCallback((next: VehicleGarage) => {
    const sanitized = sanitizeGarage(next)
    if (sanitized) setGarage(sanitized)
  }, [])

  const setProfile = useCallback((patch: Partial<VehicleProfile>) => {
    setGarage((current) =>
      updateVehicleInGarage(current, getDefaultVehicle(current).id, patch)
    )
  }, [])

  const setMpg = useCallback(
    (mpg: number) => {
      setProfile({ mpg })
    },
    [setProfile]
  )

  const profile = useMemo(() => {
    const { name, fuelType, mpg, tankGallons } = getDefaultVehicle(garage)
    return { name, fuelType, mpg, tankGallons }
  }, [garage])

  return {
    garage,
    addVehicle,
    updateVehicle,
    removeVehicle,
    setDefaultVehicle,
    replaceGarage,
    settings: profile,
    profile,
    mpg: profile.mpg,
    setMpg,
    setProfile,
    resetToDefault: useCallback(() => setMpg(DEFAULT_MPG), [setMpg]),
  }
}

export const useVehicleSettingsContext = () => {
  const context = useContext(VehicleSettingsContext)
  if (!context) {
    throw new Error(
      'useVehicleSettingsContext must be used within VehicleSettingsProvider'
    )
  }
  return context
}
