import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import './App.css'
import { GOOGLE_MAPS_API_KEY } from './config'
import { TripMap } from './features/map/TripMap'
import { useGoogleMaps } from './features/map/useGoogleMaps'
import { TripForm } from './features/trip/TripForm'
import type { TripStop } from './features/trip/types'
import {
  fetchStopForecast,
  makeForecastCacheKey,
} from './features/weather/weatherApi'
import type { StopForecast } from './features/weather/types'
import { WeatherPanel } from './features/weather/WeatherPanel'

function App() {
  const [stops, setStops] = useState<TripStop[]>([])
  const [weatherByStopId, setWeatherByStopId] = useState<
    Record<string, StopForecast>
  >({})
  const [weatherErrors, setWeatherErrors] = useState<Record<string, string>>({})
  const [importError, setImportError] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const geocodingInFlight = useRef(false)
  const weatherInFlight = useRef<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const { loaded: mapsLoaded, error: mapsError } = useGoogleMaps(
    GOOGLE_MAPS_API_KEY,
  )

  const addStop = useCallback((stop: TripStop) => {
    setStops((prev) => {
      // Keep starting points at the beginning, append others
      const startingPoints = prev.filter((s) => s.label === 'Starting point')
      const otherStops = prev.filter((s) => s.label !== 'Starting point')
      return stop.label === 'Starting point'
        ? [stop, ...otherStops]
        : [...startingPoints, ...otherStops, stop]
    })
  }, [])

  const removeStop = useCallback((stopId: string) => {
    setStops((prev) => prev.filter((stop) => stop.id !== stopId))
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

  const updateStop = useCallback((stopId: string, updates: Partial<TripStop>) => {
    setStops((prev) =>
      prev.map((stop) => (stop.id === stopId ? { ...stop, ...updates } : stop)),
    )
  }, [])

  const orderStops = useCallback((items: TripStop[]) => {
    const startingPoints = items.filter((stop) => stop.label === 'Starting point')
    const otherStops = items.filter((stop) => stop.label !== 'Starting point')
    return [...startingPoints, ...otherStops]
  }, [])

  const exportTrips = useCallback(() => {
    setImportError('')
    setImportStatus('')

    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      stops,
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const dateStamp = new Date().toISOString().slice(0, 10)
    link.href = url
    link.download = `trip-${dateStamp}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }, [stops])

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

            return {
              id: stopData.id,
              label: stopData.label,
              address: stopData.address,
              startDate: stopData.startDate,
              endDate: stopData.endDate,
              note: note ? note : undefined,
              location: hasLocation ? { lat: location.lat, lng: location.lng } : undefined,
              status: typeof stopData.status === 'string' ? stopData.status : 'idle',
            }
          })

          setStops((prev) => mergeStops(prev, sanitizedStops))
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
    [mergeStops],
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

  useEffect(() => {
    if (!mapsLoaded || geocodingInFlight.current) {
      return
    }

    const pendingStops = stops.filter(
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
  }, [mapsLoaded, stops, updateStop])

  const forecastCandidates = useMemo(() => {
    return stops
      .filter((stop) => stop.location && stop.startDate && stop.endDate)
      .map((stop) => ({
        stop,
        cacheKey: makeForecastCacheKey(stop),
      }))
      .filter(({ cacheKey }) => cacheKey)
  }, [stops])

  useEffect(() => {
    const stopIds = new Set(stops.map((stop) => stop.id))
    setWeatherByStopId((prev) => {
      const next: Record<string, StopForecast> = {}
      for (const [stopId, forecast] of Object.entries(prev)) {
        if (stopIds.has(stopId)) {
          next[stopId] = forecast
        }
      }
      return next
    })
  }, [stops])

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
            <strong>{stops.length}</strong>
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
            stops={stops}
            onAddStop={addStop}
            onRemoveStop={removeStop}
            mapsLoaded={mapsLoaded}
          />
        </section>

        <section className="panel panel-map">
          <TripMap
            stops={stops}
            mapsLoaded={mapsLoaded}
            mapsError={mapsError}
            apiKey={GOOGLE_MAPS_API_KEY}
          />
        </section>

        <section className="panel panel-weather">
          <WeatherPanel
            stops={stops}
            weatherByStopId={weatherByStopId}
            weatherErrors={weatherErrors}
          />
        </section>
      </main>
    </div>
  )
}

export default App
