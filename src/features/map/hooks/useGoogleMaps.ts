import { useEffect, useState } from 'react'

type MapsStatus = {
  loaded: boolean
  error: string | null
}

const SCRIPT_ID = 'google-maps-script'
const CALLBACK_FUNC = 'initGoogleMaps'

// Module-level state shared across all hook instances
let globalMapsLoaded = false
let globalMapsError: string | null = null
const listeners = new Set<(loaded: boolean, error: string | null) => void>()

const notifyListeners = () => {
  listeners.forEach((fn) => fn(globalMapsLoaded, globalMapsError))
}

// Global callback invoked by Google Maps script when it loads
// Must be on window for the script callback mechanism
const initGoogleMapsCallback = () => {
  try {
    console.log('Google Maps script loaded, callback triggered')

    if (!window.google?.maps?.Map) {
      throw new Error('Google Maps Map class not available')
    }

    console.log('Google Maps API ready')
    globalMapsLoaded = true
    globalMapsError = null
    notifyListeners()
  } catch (err) {
    console.error('Google Maps initialization error:', err)
    globalMapsError =
      err instanceof Error ? err.message : 'Failed to load Google Maps'
    globalMapsLoaded = false
    notifyListeners()
  }
}

// Attach callback to window so Google Maps script can invoke it
declare global {
  interface Window {
    initGoogleMaps?: () => void
  }
}

window.initGoogleMaps = initGoogleMapsCallback

export const useGoogleMaps = (apiKey: string): MapsStatus => {
  const [loaded, setLoaded] = useState(globalMapsLoaded)
  const [error, setError] = useState(globalMapsError)

  // Subscribe to global state changes
  useEffect(() => {
    const handleUpdate = (newLoaded: boolean, newError: string | null) => {
      setLoaded(newLoaded)
      setError(newError)
    }

    listeners.add(handleUpdate)
    return () => {
      listeners.delete(handleUpdate)
    }
  }, [])

  useEffect(() => {
    if (!apiKey) {
      globalMapsError = 'Missing Google Maps API key'
      globalMapsLoaded = false
      notifyListeners()
      return
    }

    // Set up authentication failure handler
    window.gm_authFailure = () => {
      globalMapsLoaded = false
      globalMapsError = 'Google Maps authentication failed'
      notifyListeners()
    }

    // Already loaded?
    if (globalMapsLoaded) {
      notifyListeners()
      return
    }

    // Already have a script tag?
    const existingScript = document.getElementById(SCRIPT_ID)
    if (existingScript) {
      console.log('Google Maps script already exists, callback will handle initialization')
      return
    }

    // Add the script with callback pattern for async loading
    // Libraries are pre-loaded in the URL (no need for individual importLibrary calls)
    console.log('Adding Google Maps script with key:', apiKey.substring(0, 20) + '...')
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly&loading=async&libraries=maps,places,marker,routes,geometry&callback=${CALLBACK_FUNC}`
    script.async = true
    script.defer = true
    script.onerror = () => {
      console.error('Failed to load Google Maps script')
      globalMapsError = 'Failed to load Google Maps script'
      notifyListeners()
    }

    document.head.appendChild(script)
  }, [apiKey])

  return { loaded, error }
}

