import { useLocalStorage } from './useLocalStorage'

/**
 * Custom hook for managing the global routesEnabled flag
 * Controls whether map loading and route calculations are enabled
 * Defaults to false to prevent bots from triggering billable API calls
 */
export function useRoutesEnabled() {
  const [routesEnabled, setRoutesEnabled] = useLocalStorage<boolean>(
    'routesEnabled',
    false
  )

  return [routesEnabled, setRoutesEnabled] as const
}
