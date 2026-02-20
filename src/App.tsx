import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import './App.css'
import { GOOGLE_MAPS_API_KEY } from './config'
import { TripMap } from './features/map/TripMap'
import { useGoogleMaps } from './features/map/useGoogleMaps'
import { TripForm } from './features/trip/TripForm'
import type { TripStop, TripStopSourceName, TripsState } from './features/trip/types'
import { TripSelector } from './features/trip/TripSelector'
import {
  fetchStopForecast,
  makeForecastCacheKey,
} from './features/weather/weatherApi'
import type { StopForecast } from './features/weather/types'
import {
  loadTripsFromStorage,
  saveTripsToStorage,
  createNewTrip,
  getCurrentTrip,
} from './utils/tripStorage'
import type { MapBounds } from './utils/campsiteSearch'

function App() {
  const allowedSourceNames = useMemo(
    () => new Set<TripStopSourceName>(['Campendium', 'Harvest Hosts', 'RV Parky', 'Other']),
    []
  )
  const [tripsState, setTripsState] = useState<TripsState>(() => {
    return loadTripsFromStorage()
  })
  const [weatherByStopId, setWeatherByStopId] = useState<
    Record<string, StopForecast>
  >({})
  const [weatherErrors, setWeatherErrors] = useState<Record<string, string>>({})
  const [importError, setImportError] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const [selectedStopIds, setSelectedStopIds] = useState<Set<string>>(new Set())
  const [mapBounds, setMapBounds] = useState<MapBounds | undefined>()
  const geocodingInFlight = useRef(false)
  const weatherInFlight = useRef<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const { loaded: mapsLoaded, error: mapsError } = useGoogleMaps(
    GOOGLE_MAPS_API_KEY,
  )

  const currentTrip = getCurrentTrip(tripsState)
  const currentStops = currentTrip?.stops ?? []

  // Auto-save trips state to localStorage
  useEffect(() => {
    if (tripsState.trips.length > 0) {
      saveTripsToStorage(tripsState)
    }
  }, [tripsState])

  const addStop = useCallback(
    (stop: TripStop) => {
      if (!currentTrip) return

      setTripsState((prev) => {
        const tripIndex = prev.trips.findIndex((t) => t.id === prev.currentTripId)
        if (tripIndex === -1) return prev

        const updatedTrips = [...prev.trips]
        const trip = updatedTrips[tripIndex]

        // Keep starting points at the beginning, append others
        const startingPoints = trip.stops.filter((s) => s.label === 'Starting point')
        const otherStops = trip.stops.filter((s) => s.label !== 'Starting point')
        const newStops =
          stop.label === 'Starting point'
            ? [stop, ...otherStops]
            : [...startingPoints, ...otherStops, stop]

        updatedTrips[tripIndex] = {
          ...trip,
          stops: newStops,
          updatedAt: new Date().toISOString(),
        }

        return {
          ...prev,
          trips: updatedTrips,
        }
      })
    },
    [currentTrip]
  )

  const removeStop = useCallback((stopId: string) => {
    setTripsState((prev) => {
      const tripIndex = prev.trips.findIndex((t) => t.id === prev.currentTripId)
      if (tripIndex === -1) return prev

      const updatedTrips = [...prev.trips]
      updatedTrips[tripIndex] = {
        ...updatedTrips[tripIndex],
        stops: updatedTrips[tripIndex].stops.filter((s) => s.id !== stopId),
        updatedAt: new Date().toISOString(),
      }

      return {
        ...prev,
        trips: updatedTrips,
      }
    })

    setWeatherByStopId((prev) => {
      const next = { ...prev }
      delete next[stopId]
      return next
    })
    setWeatherErrors((prev) => {
      const next = { ...prev }
      delete next[stopId]
      return next
    })
  }, [])

  const updateStop = useCallback(
    (stopId: string, updates: Partial<TripStop>) => {
      setTripsState((prev) => {
        const tripIndex = prev.trips.findIndex((t) => t.id === prev.currentTripId)
        if (tripIndex === -1) return prev

        const updatedTrips = [...prev.trips]
        updatedTrips[tripIndex] = {
          ...updatedTrips[tripIndex],
          stops: updatedTrips[tripIndex].stops.map((stop) =>
            stop.id === stopId ? { ...stop, ...updates } : stop
          ),
          updatedAt: new Date().toISOString(),
        }

        return {
          ...prev,
          trips: updatedTrips,
        }
      })
    },
    []
  )

  const orderStops = useCallback((items: TripStop[]) => {
    const startingPoints = items.filter((stop) => stop.label === 'Starting point')
    const otherStops = items.filter((stop) => stop.label !== 'Starting point')
    return [...startingPoints, ...otherStops]
  }, [])

  const exportTrips = useCallback(() => {
    setImportError('')
    setImportStatus('')

    if (!currentTrip) {
      setImportError('No trip to export. Create a trip first.')
      return
    }

    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      stops: currentTrip.stops,
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const dateStamp = new Date().toISOString().slice(0, 10)
    link.href = url
    link.download = `trip-${currentTrip.name}-${dateStamp}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }, [currentTrip])

  const mergeStops = useCallback(
    (existing: TripStop[], imported: TripStop[]) => {
      const existingIds = new Set(existing.map((stop) => stop.id))
      const next: TripStop[] = [...existing]

      for (const stop of imported) {
        if (existingIds.has(stop.id)) {
          continue
        }

        existingIds.add(stop.id)
        next.push(stop)
      }

      return orderStops(next)
    },
    [orderStops],
  )

  const handleImportFile = useCallback(
    (file: File) => {
      setImportError('')
      setImportStatus('Importing...')

      if (!currentTrip) {
        setImportStatus('')
        setImportError('No trip to import to. Create a trip first.')
        return
      }

      const reader = new FileReader()
      reader.onerror = () => {
        setImportStatus('')
        setImportError('Unable to read that file.')
      }
      reader.onload = () => {
        try {
          const raw = JSON.parse(String(reader.result ?? ''))
          const payloadStops = Array.isArray(raw)
            ? raw
            : Array.isArray(raw?.stops)
              ? raw.stops
              : null

          if (!payloadStops) {
            throw new Error('Invalid format')
          }

          const sanitizedStops: TripStop[] = payloadStops.map((stop: unknown) => {
            if (!stop || typeof stop !== 'object') {
              throw new Error('Invalid stop')
            }

            const stopData = stop as Record<string, unknown>

            if (
              typeof stopData.id !== 'string' ||
              typeof stopData.label !== 'string' ||
              typeof stopData.address !== 'string' ||
              typeof stopData.startDate !== 'string' ||
              typeof stopData.endDate !== 'string'
            ) {
              throw new Error('Invalid stop')
            }

            const location = stopData.location as
              | { lat?: unknown; lng?: unknown }
              | undefined
            const hasLocation =
              location &&
              typeof location.lat === 'number' &&
              typeof location.lng === 'number'
            const note =
              typeof stopData.note === 'string'
                ? stopData.note.trim().slice(0, 500)
                : ''
            const rawSource = stopData.source
            const source =
              rawSource && typeof rawSource === 'object'
                ? (rawSource as Record<string, unknown>)
                : null
            const sourceName =
              source && typeof source.name === 'string' ? source.name : undefined
            const sourceUrl =
              source && typeof source.url === 'string' ? source.url : undefined
            const sourceSiteType =
              source && typeof source.siteType === 'string'
                ? source.siteType
                : undefined
            const sourceFees =
              source && typeof source.fees === 'string' ? source.fees : undefined
            const sourceAmenities =
              source && typeof source.amenities === 'string'
                ? source.amenities
                : undefined
            const normalizedSourceName = sourceName
              ? allowedSourceNames.has(sourceName as TripStopSourceName)
                ? (sourceName as TripStopSourceName)
                : undefined
              : undefined
            const hasSourceDetails =
              Boolean(normalizedSourceName) ||
              Boolean(sourceUrl) ||
              Boolean(sourceSiteType) ||
              Boolean(sourceFees) ||
              Boolean(sourceAmenities)
            const sanitizedSource = hasSourceDetails
              ? {
                  name: normalizedSourceName ?? 'Other',
                  url: sourceUrl,
                  siteType: sourceSiteType,
                  fees: sourceFees,
                  amenities: sourceAmenities,
                }
              : undefined

            return {
              id: stopData.id,
              label: stopData.label,
              address: stopData.address,
              startDate: stopData.startDate,
              endDate: stopData.endDate,
              note: note ? note : undefined,
              source: sanitizedSource,
              location: hasLocation ? { lat: location.lat, lng: location.lng } : undefined,
              status: typeof stopData.status === 'string' ? stopData.status : 'idle',
            }
          })

          setTripsState((prev) => {
            const tripIndex = prev.trips.findIndex((t) => t.id === prev.currentTripId)
            if (tripIndex === -1) return prev

            const updatedTrips = [...prev.trips]
            updatedTrips[tripIndex] = {
              ...updatedTrips[tripIndex],
              stops: mergeStops(updatedTrips[tripIndex].stops, sanitizedStops),
              updatedAt: new Date().toISOString(),
            }

            return {
              ...prev,
              trips: updatedTrips,
            }
          })

          setWeatherByStopId({})
          setWeatherErrors({})
          setImportStatus(`Imported ${sanitizedStops.length} stops.`)
        } catch (error) {
          setImportStatus('')
          setImportError(
            error instanceof Error
              ? 'That file does not contain valid trip data.'
              : 'Unable to import that file.',
          )
        }
      }

      reader.readAsText(file)
    },
    [currentTrip, mergeStops],
  )

  const onImportChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) {
        return
      }

      handleImportFile(file)
      event.target.value = ''
    },
    [handleImportFile],
  )

  const handleSelectTrip = useCallback((tripId: string) => {
    setTripsState((prev) => ({
      ...prev,
      currentTripId: tripId,
    }))
    // Clear weather when switching trips - it will refetch for the new trip
    setWeatherByStopId({})
    setWeatherErrors({})
    // Clear selection when switching trips
    setSelectedStopIds(new Set())
  }, [])

  const handleCreateTrip = useCallback((name: string) => {
    const newTrip = createNewTrip(name)
    setTripsState((prev) => ({
      trips: [...prev.trips, newTrip],
      currentTripId: newTrip.id,
    }))
    // Clear weather for new trip
    setWeatherByStopId({})
    setWeatherErrors({})
    // Clear selection for new trip
    setSelectedStopIds(new Set())
  }, [])

  const toggleStopSelection = useCallback((stopId: string) => {
    setSelectedStopIds((prev) => {
      const next = new Set(prev)
      if (next.has(stopId)) {
        next.delete(stopId)
      } else {
        next.add(stopId)
      }
      return next
    })
  }, [])

  const selectAllStops = useCallback(() => {
    setSelectedStopIds(new Set(currentStops.map((stop) => stop.id)))
  }, [currentStops])

  const clearStopSelection = useCallback(() => {
    setSelectedStopIds(new Set())
  }, [])

  const handleDeleteTrip = useCallback((tripId: string) => {
    setTripsState((prev) => {
      const remainingTrips = prev.trips.filter((t) => t.id !== tripId)
      if (remainingTrips.length === 0) {
        return {
          trips: [],
          currentTripId: null,
        }
      }

      const newCurrentTripId =
        prev.currentTripId === tripId ? remainingTrips[0].id : prev.currentTripId

      return {
        trips: remainingTrips,
        currentTripId: newCurrentTripId,
      }
    })
    // Clear weather when deleting trip
    setWeatherByStopId({})
    setWeatherErrors({})
    // Clear selection when deleting trip
    setSelectedStopIds(new Set())
  }, [])

  useEffect(() => {
    if (!mapsLoaded || geocodingInFlight.current) {
      return
    }

    const pendingStops = currentStops.filter(
      (stop) =>
        !stop.location && stop.status !== 'geocoding' && stop.status !== 'error',
    )

    if (pendingStops.length === 0) {
      return
    }

    geocodingInFlight.current = true
    let cancelled = false

    const run = async () => {
      for (const stop of pendingStops) {
        updateStop(stop.id, { status: 'geocoding' })
        try {
          const geocoder = new google.maps.Geocoder()
          const result = await geocoder.geocode({ address: stop.address })
          if (cancelled) {
            return
          }

          if (!result.results[0]) {
            updateStop(stop.id, { status: 'error' })
            continue
          }

          const location = result.results[0].geometry.location
          updateStop(stop.id, {
            location: { lat: location.lat(), lng: location.lng() },
            status: 'ready',
          })
        } catch (error) {
          if (!cancelled) {
            updateStop(stop.id, { status: 'error' })
          }
        }
      }
    }

    run()
      .catch(() => undefined)
      .finally(() => {
        geocodingInFlight.current = false
      })

    return () => {
      cancelled = true
    }
  }, [mapsLoaded, currentStops, updateStop])

  const forecastCandidates = useMemo(() => {
    return currentStops
      .filter((stop) => stop.location && stop.startDate && stop.endDate)
      .map((stop) => ({
        stop,
        cacheKey: makeForecastCacheKey(stop),
      }))
      .filter(({ cacheKey }) => cacheKey)
  }, [currentStops])

  useEffect(() => {
    const stopIds = new Set(currentStops.map((stop) => stop.id))
    setWeatherByStopId((prev) => {
      const next: Record<string, StopForecast> = {}
      for (const [stopId, forecast] of Object.entries(prev)) {
        if (stopIds.has(stopId)) {
          next[stopId] = forecast
        }
      }
      return next
    })
  }, [currentStops])

  useEffect(() => {
    forecastCandidates.forEach(({ stop, cacheKey }) => {
      const currentForecast = weatherByStopId[stop.id]
      const needsFetch =
        !currentForecast || currentForecast.cacheKey !== cacheKey

      if (!needsFetch || weatherInFlight.current.has(stop.id)) {
        return
      }

      weatherInFlight.current.add(stop.id)
      fetchStopForecast(stop)
        .then((forecast) => {
          setWeatherByStopId((prev) => ({
            ...prev,
            [stop.id]: forecast,
          }))
          setWeatherErrors((prev) => {
            const next = { ...prev }
            delete next[stop.id]
            return next
          })
        })
        .catch((error) => {
          setWeatherErrors((prev) => ({
            ...prev,
            [stop.id]:
              error instanceof Error ? error.message : 'Weather lookup failed',
          }))
        })
        .finally(() => {
          weatherInFlight.current.delete(stop.id)
        })
    })
  }, [forecastCandidates, weatherByStopId])

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">RV Trip Planner</p>
          <h1>Route, schedule, and weather in one place.</h1>
          <p className="hero-subtitle">
            Add each stop with dates, and the planner will map your route and
            pull forecasts for the days you are there.
          </p>
          <div className="trip-selector-wrapper">
            <TripSelector
              tripsState={tripsState}
              onSelectTrip={handleSelectTrip}
              onCreateTrip={handleCreateTrip}
              onDeleteTrip={handleDeleteTrip}
            />
          </div>
          <div className="hero-actions">
            <button className="ghost" type="button" onClick={exportTrips}>
              Save trip
            </button>
            <input
              ref={fileInputRef}
              className="file-input"
              type="file"
              accept="application/json"
              onChange={onImportChange}
            />
            <button
              className="ghost"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              Load trip
            </button>
            {importStatus ? <span className="import-status">{importStatus}</span> : null}
            {importError ? <span className="import-error">{importError}</span> : null}
          </div>
        </div>
        <div className="hero-card">
          <div className="hero-card-row">
            <span>Stops</span>
            <strong>{currentStops.length}</strong>
          </div>
          <div className="hero-card-row">
            <span>Maps</span>
            <strong>{mapsLoaded ? 'Ready' : mapsError ? 'Needs key' : 'Loading'}</strong>
          </div>
          <div className="hero-card-row">
            <span>Weather</span>
            <strong>Hybrid (NOAA+Climate)</strong>
          </div>
        </div>
      </header>

      <main className="grid">
        <section className="panel panel-form">
          <TripForm
            stops={currentStops}
            onAddStop={addStop}
            onRemoveStop={removeStop}
            mapsLoaded={mapsLoaded}
            weatherByStopId={weatherByStopId}
            weatherErrors={weatherErrors}
            selectedStopIds={selectedStopIds}
            onToggleStopSelection={toggleStopSelection}
            onSelectAllStops={selectAllStops}
            onClearStopSelection={clearStopSelection}
            mapBounds={mapBounds}
          />
        </section>

        <section className="panel panel-map">
          <TripMap
            stops={currentStops}
            mapsLoaded={mapsLoaded}
            mapsError={mapsError}
            apiKey={GOOGLE_MAPS_API_KEY}
            onBoundsChange={setMapBounds}
          />
        </section>
      </main>
    </div>
  )
}

export default App
