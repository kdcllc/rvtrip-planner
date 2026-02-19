import { useState } from 'react'

/**
 * Custom hook for managing localStorage with JSON serialization
 * Syncs state with localStorage and handles JSON serialization/deserialization
 */
export function useLocalStorage<T>(key: string, initialValue: T) {
  // Store the initial value in state
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      // Get from local storage by key
      const item = window.localStorage.getItem(key)
      if (item) {
        return JSON.parse(item)
      }
      return initialValue
    } catch (error) {
      console.error(`Error reading from localStorage key "${key}":`, error)
      return initialValue
    }
  })

  // Return a wrapped version of useState's setter function that
  // persists the new value to localStorage
  const setValue = (value: T | ((val: T) => T)) => {
    try {
      // Allow value to be a function so we have same API as useState
      const valueToStore = value instanceof Function ? value(storedValue) : value
      setStoredValue(valueToStore)
      // Save to local storage
      window.localStorage.setItem(key, JSON.stringify(valueToStore))
    } catch (error) {
      console.error(`Error writing to localStorage key "${key}":`, error)
    }
  }

  return [storedValue, setValue] as const
}
