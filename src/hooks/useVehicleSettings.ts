import { useState, useEffect, useContext, createContext } from 'react'

const VEHICLE_SETTINGS_KEY = 'trip-planner:vehicleSettings'
const DEFAULT_MPG = 25

export type VehicleSettings = {
  mpg: number
}

export type VehicleSettingsContextValue = {
  mpg: number
  debouncedMpg: number
  setMpg: (mpg: number) => void
  resetToDefault: () => void
}

export const VehicleSettingsContext =
  createContext<VehicleSettingsContextValue | null>(null)

/**
 * Hook to persist and manage global vehicle settings (MPG)
 * Reads from localStorage on mount, persists changes immediately
 */
export const useVehicleSettings = (initialMpg?: number) => {
  const [settings, setSettings] = useState<VehicleSettings>(() => {
    try {
      const stored = localStorage.getItem(VEHICLE_SETTINGS_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as VehicleSettings
        const rawMpg = parsed.mpg ?? initialMpg ?? DEFAULT_MPG
        const clampedMpg = Number.isFinite(rawMpg)
          ? Math.max(5, Math.min(100, rawMpg))
          : initialMpg ?? DEFAULT_MPG
        return { mpg: clampedMpg }
      }
    } catch (error) {
      console.error('Failed to parse vehicle settings from localStorage:', error)
    }
    return { mpg: initialMpg ?? DEFAULT_MPG }
  })

  // Persist to localStorage whenever settings change
  useEffect(() => {
    try {
      localStorage.setItem(VEHICLE_SETTINGS_KEY, JSON.stringify(settings))
    } catch (error) {
      console.error('Failed to persist vehicle settings to localStorage:', error)
    }
  }, [settings])

  const setMpg = (mpg: number) => {
    // Validate MPG is within reasonable range
    const validMpg = Math.max(5, Math.min(100, mpg))
    setSettings({ mpg: validMpg })
  }

  return {
    settings,
    mpg: settings.mpg,
    setMpg,
    // Helper to reset to default
    resetToDefault: () => setMpg(DEFAULT_MPG),
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
