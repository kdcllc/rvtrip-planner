import { useState, useEffect } from 'react'

const VEHICLE_SETTINGS_KEY = 'trip-planner:vehicleSettings'
const DEFAULT_MPG = 25

export type VehicleSettings = {
  mpg: number
}

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
        return { mpg: parsed.mpg ?? initialMpg ?? DEFAULT_MPG }
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
