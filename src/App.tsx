import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  const geocodingInFlight = useRef(false)
  const weatherInFlight = useRef<Set<string>>(new Set())

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
