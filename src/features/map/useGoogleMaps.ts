import { useEffect, useState } from 'react'

type MapsStatus = {
  loaded: boolean
  error: string | null
}

const SCRIPT_ID = 'google-maps-script'
const CALLBACK_NAME = '__googleMapsCallback'

// Module-level state shared across all hook instances
let globalMapsLoaded = false
let globalMapsError: string | null = null
const listeners = new Set<(loaded: boolean, error: string | null) => void>()

const notifyListeners = () => {
  listeners.forEach((fn) => fn(globalMapsLoaded, globalMapsError))
}

// Set up the callback IMMEDIATELY when this module loads
const initializeCallback = () => {
  ;(window as any)[CALLBACK_NAME] = async () => {
    console.log('Google Maps callback triggered')

    if (!window.google?.maps) {
      console.error('Google Maps not available')
      globalMapsError = 'Google Maps not available'
      notifyListeners()
      return
    }

    try {
      // Import required libraries
      console.log('Importing Google Maps libraries...')
      await Promise.all([
        window.google.maps.importLibrary('maps'),
        window.google.maps.importLibrary('places'),
        window.google.maps.importLibrary('marker'),
        window.google.maps.importLibrary('routes'),
        window.google.maps.importLibrary('geometry'),
      ])

      console.log('Libraries imported successfully')

      if (window.google?.maps?.Map) {
        console.log('Google Maps API ready')
        globalMapsLoaded = true
        globalMapsError = null
      } else {
        console.error('Google Maps Map class not available')
        globalMapsError = 'Google Maps failed to initialize'
      }
      notifyListeners()
    } catch (err) {
      console.error('Google Maps library import error:', err)
      globalMapsError =
        err instanceof Error ? err.message : 'Failed to load Google Maps libraries'
      notifyListeners()
    }
  }
}

// Initialize callback when module loads (before any components use this hook)
initializeCallback()

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
      setLoaded(true)
      setError(null)
      return
    }

    // Already have a script tag?
    const existingScript = document.getElementById(SCRIPT_ID)
    if (existingScript) {
      console.log('Script already exists, waiting for callback...')
      return
    }

    // Add the script
    console.log('Adding Google Maps script with key:', apiKey.substring(0, 20) + '...')
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly&callback=${CALLBACK_NAME}`
    script.async = true
    script.onerror = () => {
      console.error('Failed to load Google Maps script')
      globalMapsError = 'Failed to load Google Maps script'
      notifyListeners()
    }

    document.head.appendChild(script)
  }, [apiKey])

  return { loaded, error }
}

