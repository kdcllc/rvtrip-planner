import type { Trip, TripsState, TripStop } from '../../domain/trip/types'
import { createId } from '../../utils/id'

const STORAGE_KEY = 'trip-planner-trips'
const LEGACY_STORAGE_KEY = 'exported-trips'

/**
 * Load trips state from localStorage
 * Handles migration from legacy export format
 */
export function loadTripsFromStorage(): TripsState {
  try {
    // Try to load new format first
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const state = JSON.parse(stored) as TripsState
      // Set current trip to first if not set
      if (!state.currentTripId && state.trips.length > 0) {
        state.currentTripId = state.trips[0].id
      }
      return state
    }

    // Try to migrate from legacy format
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy) {
      const parsed = JSON.parse(legacy) as { version: string; trips: TripStop[] }
      if (parsed.trips && Array.isArray(parsed.trips)) {
        const newTrip: Trip = {
          id: createId(),
          name: 'Imported Trip',
          stops: parsed.trips,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        const newState: TripsState = {
          trips: [newTrip],
          currentTripId: newTrip.id,
        }
        saveTripsToStorage(newState)
        return newState
      }
    }

    // Create a default trip for new users
    const defaultTrip: Trip = {
      id: createId(),
      name: 'My First Trip',
      stops: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const defaultState: TripsState = {
      trips: [defaultTrip],
      currentTripId: defaultTrip.id,
    }
    // Don't save to storage on first load - let user actions trigger that
    return defaultState
  } catch (error) {
    console.error('Error loading trips from storage:', error)
    // Return default state even on error
    const defaultTrip: Trip = {
      id: createId(),
      name: 'My First Trip',
      stops: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    return {
      trips: [defaultTrip],
      currentTripId: defaultTrip.id,
    }
  }
}

/**
 * Save trips state to localStorage
 */
export function saveTripsToStorage(state: TripsState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (error) {
    console.error('Error saving trips to storage:', error)
  }
}

/**
 * Create a new trip
 */
export function createNewTrip(name: string): Trip {
  const id = createId()
  return {
    id,
    name: name.trim() || 'Untitled Trip',
    stops: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Get the current trip from state
 */
export function getCurrentTrip(state: TripsState): Trip | null {
  if (!state.currentTripId) return null
  return state.trips.find((trip) => trip.id === state.currentTripId) || null
}

/**
 * Get all trip names sorted by most recent first
 */
export function getTripsSortedByRecent(trips: Trip[]): Trip[] {
  return [...trips].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
}

/**
 * Update the updatedAt timestamp for a trip
 */
export function updateTripTimestamp(trip: Trip): Trip {
  return {
    ...trip,
    updatedAt: new Date().toISOString(),
  }
}
