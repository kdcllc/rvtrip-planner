import {
  useState,
  useEffect,
  useCallback,
  useContext,
  createContext,
} from 'react'
import {
  MPG_MAX,
  MPG_MIN,
  TANK_GALLONS_MAX,
  TANK_GALLONS_MIN,
  VEHICLE_NAME_MAX_LENGTH,
  type VehicleProfile,
} from '../types/api'

const VEHICLE_SETTINGS_KEY = 'trip-planner:vehicleSettings'
const DEFAULT_MPG = 25

export type VehicleSettings = VehicleProfile

export type ProfileSyncStatus = 'local' | 'loading' | 'synced' | 'error'

export type VehicleSettingsContextValue = {
  mpg: number
  debouncedMpg: number
  setMpg: (mpg: number) => void
  resetToDefault: () => void
  profile: VehicleProfile
  debouncedProfile: VehicleProfile
  setProfile: (patch: Partial<VehicleProfile>) => void
  replaceProfile: (profile: VehicleProfile) => void
  profileSyncStatus: ProfileSyncStatus
  setProfileSyncStatus: (status: ProfileSyncStatus) => void
}

export const VehicleSettingsContext =
  createContext<VehicleSettingsContextValue | null>(null)

const clampMpg = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(MPG_MIN, Math.min(MPG_MAX, value))
    : fallback

/**
 * Validate a profile-shaped value. The name is cut to the maximum length;
 * surrounding whitespace is trimmed only when `trimName` is set (on read).
 */
const sanitizeProfile = (
  raw: Partial<Record<keyof VehicleProfile, unknown>> | null | undefined,
  defaultMpg: number,
  trimName: boolean
): VehicleProfile => {
  const source = raw ?? {}
  const rawName = typeof source.name === 'string' ? source.name : ''
  const name = (trimName ? rawName.trim() : rawName).slice(
    0,
    VEHICLE_NAME_MAX_LENGTH
  )
  const tank = source.tankGallons
  const tankGallons =
    typeof tank === 'number' &&
    Number.isFinite(tank) &&
    tank >= TANK_GALLONS_MIN &&
    tank <= TANK_GALLONS_MAX
      ? tank
      : null
  return {
    name,
    fuelType: source.fuelType === 'diesel' ? 'diesel' : 'gasoline',
    mpg: clampMpg(source.mpg, clampMpg(defaultMpg, DEFAULT_MPG)),
    tankGallons,
  }
}

/**
 * Hook to persist and manage the global RV profile (name, fuel type, MPG, tank)
 * Reads from localStorage on mount, persists changes immediately
 */
export const useVehicleSettings = (initialMpg?: number) => {
  const [settings, setSettings] = useState<VehicleProfile>(() => {
    const fallbackMpg = initialMpg ?? DEFAULT_MPG
    try {
      const stored = localStorage.getItem(VEHICLE_SETTINGS_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<
          Record<keyof VehicleProfile, unknown>
        > | null
        return sanitizeProfile(parsed, fallbackMpg, true)
      }
    } catch (error) {
      console.error('Failed to parse vehicle settings from localStorage:', error)
    }
    return sanitizeProfile(null, fallbackMpg, true)
  })

  // Persist to localStorage whenever settings change
  useEffect(() => {
    try {
      localStorage.setItem(VEHICLE_SETTINGS_KEY, JSON.stringify(settings))
    } catch (error) {
      console.error('Failed to persist vehicle settings to localStorage:', error)
    }
  }, [settings])

  const setProfile = useCallback((patch: Partial<VehicleProfile>) => {
    setSettings((current) =>
      sanitizeProfile({ ...current, ...patch }, current.mpg, false)
    )
  }, [])

  const replaceProfile = useCallback((profile: VehicleProfile) => {
    setSettings(sanitizeProfile(profile, DEFAULT_MPG, false))
  }, [])

  const setMpg = useCallback(
    (mpg: number) => {
      setProfile({ mpg })
    },
    [setProfile]
  )

  return {
    settings,
    profile: settings,
    mpg: settings.mpg,
    setMpg,
    setProfile,
    replaceProfile,
    // Helper to reset to default
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
