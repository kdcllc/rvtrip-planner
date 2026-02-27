import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import './App.css'
import { OPENROUTE_API_KEY } from '../config/env'
import { TripMap } from '../features/map/TripMap'
import { TripForm, type TripFormRef } from '../features/trip/TripForm'
import type { TripStop, TripStopSourceName, TripsState } from '../domain/trip/types'
import { TripSelector } from '../features/trip/TripSelector'
import { VehicleSettingsModal } from '../features/trip/VehicleSettingsModal'
import {
  fetchStopForecast,
  makeForecastCacheKey,
} from '../services/weather/weatherService'
import type { StopForecast } from '../domain/weather/types'
import {
  loadTripsFromStorage,
  saveTripsToStorage,
  createNewTrip,
  getCurrentTrip,
} from '../services/storage/tripStorage'
import type { MapBounds } from '../services/campsiteSearch'
import {
  generateICalendar,
  downloadICalendar,
} from '../services/calendar/calendarService'
import { gasPriceService } from '../services/gas/gasPriceService'
import { calculateTripDistances, formatDistance } from '../utils/distance'
import { calculateStopCosts, calculateTripTotalAccommodationCost } from '../utils/costCalculation'
import { buildTripPrintStops, calculateTotalDistanceMeters } from '../utils/print'
import { useVehicleSettingsContext } from '../hooks/useVehicleSettings'
import type { GasPriceLookupResult } from '../domain/gas/types'
import { useGoogleDriveSync } from '../hooks/useGoogleDriveSync'
import { DriveSyncControls } from '../components/common/DriveSyncControls'
import { UnifiedConflictModal } from '../components/common/UnifiedConflictModal'
import {
  buildDriveTripPayload,
  createTripFileName,
  type DriveTripPayload,
  parseDriveTripPayload,
} from '../services/drive/tripDriveSync'
import { geocodeAddress } from '../services/geocoding/geocodingService'
import { ImportTripModal } from '../components/common/ImportTripModal'
import { FloatingActionButtons } from '../components/common/FloatingActionButtons'
import { DeleteTripModal } from '../components/common/DeleteTripModal'
import { ThemeToggle } from '../components/common/ThemeToggle'
import { createId } from '../utils/id'
import { downloadTripPdf } from '../services/print/printTripPdf'
import type { TripPrintData } from '../domain/trip/print'
import { useRoutesEnabled } from '../hooks/useRoutesEnabled'
import { createOpenSourceRoutingProvider } from '../services/maps/openSourceRouting'
import { setRoutingProvider } from '../services/maps/routesService'

function App() {
  const allowedSourceNames = useMemo(
    () =>
      new Set<TripStopSourceName>([
        'RV Life',
        'Hipcamp',
        'Campendium',
        'Harvest Hosts',
        'RV Parky',
        'Other',
      ]),
    []
  )
  const [tripsState, setTripsState] = useState<TripsState>(() => {
    return loadTripsFromStorage()
  })
  const [weatherByStopId, setWeatherByStopId] = useState<
    Record<string, StopForecast>
  >({})
  const [weatherErrors, setWeatherErrors] = useState<Record<string, string>>({})
  const [gasPriceByState, setGasPriceByState] = useState<
    Record<string, GasPriceLookupResult>
  >({})
  const [importError, setImportError] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const [printError, setPrintError] = useState('')
  const [printStatus, setPrintStatus] = useState('')
  const [pendingImport, setPendingImport] = useState<{
    payload: DriveTripPayload
    skippedStops: number
    totalStops: number
  } | null>(null)
  const [selectedStopIds, setSelectedStopIds] = useState<Set<string>>(new Set())
  const [mapBounds, setMapBounds] = useState<MapBounds | undefined>()
  const [currentStopId, setCurrentStopId] = useState<string | null>(null)
  const [showVehicleSettings, setShowVehicleSettings] = useState(false)
  const [heroTab, setHeroTab] = useState<'actions' | 'drive'>('actions')
  const [isMapVisible, setIsMapVisible] = useState(true)
  const [pendingDeleteTripId, setPendingDeleteTripId] = useState<string | null>(null)
  const geocodingInFlight = useRef(false)
  const mapPanelRef = useRef<HTMLElement | null>(null)
  const tripFormRef = useRef<TripFormRef>(null)
  const weatherInFlight = useRef<Set<string>>(new Set())
  const gasPriceInFlight = useRef<Set<string>>(new Set())
  const distanceCalculationInFlight = useRef(false)
  const previousLocationsRef = useRef<string>('')
  const previousMpgRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { debouncedMpg } = useVehicleSettingsContext()
  const driveSync = useGoogleDriveSync(tripsState, setTripsState)
  const [routesEnabled] = useRoutesEnabled()

  useEffect(() => {
    const provider = createOpenSourceRoutingProvider({
      openRouteServiceApiKey: OPENROUTE_API_KEY || undefined,
    })
    setRoutingProvider(provider)
  }, [])

  const currentTrip = getCurrentTrip(tripsState)
  const currentStops = useMemo(() => currentTrip?.stops ?? [], [currentTrip])

  const tripTotalFuelCost = useMemo(() => {
    return currentStops.reduce((total, stop) => {
      return total + (stop.estimatedFuelCost ?? 0)
    }, 0)
  }, [currentStops])

  const tripTotalDistanceMeters = useMemo(() => {
    return currentStops.reduce((total, stop) => {
      return total + (stop.distanceFromPreviousMeters ?? 0)
    }, 0)
  }, [currentStops])

  const tripTotalAccommodationCost = useMemo(() => {
    return calculateTripTotalAccommodationCost(currentStops)
  }, [currentStops])

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

  const reorderStops = useCallback(
    (stopId: string, direction: 'up' | 'down') => {
      if (!currentTrip) return

      setTripsState((prev) => {
        const tripIndex = prev.trips.findIndex((t) => t.id === prev.currentTripId)
        if (tripIndex === -1) return prev

        const trip = prev.trips[tripIndex]
        const stops = [...trip.stops]
        const currentIndex = stops.findIndex((s) => s.id === stopId)
        
        if (currentIndex === -1) return prev

        // Calculate target index based on direction
        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
        
        // Validate target index is within bounds
        if (targetIndex < 0 || targetIndex >= stops.length) return prev

        // Don't allow reordering if it would separate starting points from the beginning
        const isStartingPoint = stops[currentIndex].label === 'Starting point'
        const targetIsStartingPoint = stops[targetIndex].label === 'Starting point'
        
        // Starting points must stay at the beginning
        if (isStartingPoint && direction === 'down' && !targetIsStartingPoint) {
          return prev
        }
        if (!isStartingPoint && direction === 'up' && targetIsStartingPoint) {
          return prev
        }

        // Swap the stops
        const temp = stops[currentIndex]
        stops[currentIndex] = stops[targetIndex]
        stops[targetIndex] = temp

        const updatedTrips = [...prev.trips]
        updatedTrips[tripIndex] = {
          ...trip,
          stops,
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

    const payload = buildDriveTripPayload(currentTrip)

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = createTripFileName(currentTrip)
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }, [currentTrip])

  const exportCalendar = useCallback(() => {
    setImportError('')
    setImportStatus('')

    if (!currentTrip) {
      setImportError('No trip to export. Create a trip first.')
      return
    }

    // Determine which stops to export: selected if any, otherwise all
    const stopsToExport =
      selectedStopIds.size > 0
        ? currentTrip.stops.filter((stop) => selectedStopIds.has(stop.id))
        : currentTrip.stops

    if (stopsToExport.length === 0) {
      setImportError('No stops to export.')
      return
    }

    try {
      const icalContent = generateICalendar(stopsToExport, currentTrip.name)
      const dateStamp = new Date().toISOString().slice(0, 10)
      const filename = `trip-${currentTrip.name}-${dateStamp}`
      downloadICalendar(icalContent, filename)
      setImportStatus(
        `Exported ${stopsToExport.length} stop${stopsToExport.length === 1 ? '' : 's'} to calendar`
      )
      setTimeout(() => setImportStatus(''), 3000)
    } catch (error) {
      setImportError(
        `Failed to export calendar: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }, [currentTrip, selectedStopIds])

  const exportTripPdf = useCallback(async () => {
    setPrintError('')
    setPrintStatus('')

    if (!currentTrip) {
      setPrintError('No trip to print. Create a trip first.')
      return
    }

    const stopsToPrint =
      selectedStopIds.size > 0
        ? currentTrip.stops.filter((stop) => selectedStopIds.has(stop.id))
        : currentTrip.stops

    if (stopsToPrint.length === 0) {
      setPrintError('No stops to print.')
      return
    }

    try {
      const printStops = buildTripPrintStops(stopsToPrint, weatherByStopId)
      const totalDistanceMeters = calculateTotalDistanceMeters(printStops)
      const selectionNote =
        selectedStopIds.size > 0
          ? `Selected ${stopsToPrint.length} of ${currentTrip.stops.length} stops`
          : undefined

      const printData: TripPrintData = {
        tripName: currentTrip.name,
        exportedAt: new Date().toISOString(),
        selectionNote,
        stops: printStops,
        totalDistanceMeters,
        totalFuelCost: tripTotalFuelCost,
        totalAccommodationCost: tripTotalAccommodationCost,
      }

      const dateStamp = new Date().toISOString().slice(0, 10)
      const filename = `trip-${currentTrip.name}-${dateStamp}.pdf`
      await downloadTripPdf(printData, { fileName: filename })

      setPrintStatus(
        `Saved PDF for ${stopsToPrint.length} stop${stopsToPrint.length === 1 ? '' : 's'}`
      )
      setTimeout(() => setPrintStatus(''), 3000)
    } catch (error) {
      setPrintError(
        `Failed to export PDF: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }, [currentTrip, selectedStopIds, weatherByStopId, tripTotalFuelCost, tripTotalAccommodationCost])

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

  const completeImport = useCallback(
    (
      payload: DriveTripPayload,
      skippedStops: number,
      _totalStops: number,
      mode: 'merge' | 'new',
    ) => {
      const sanitizedStops = payload.trip.stops

      setTripsState((prev) => {
        const tripIndex = prev.trips.findIndex((t) => t.id === prev.currentTripId)

        if (tripIndex === -1 || mode === 'new') {
          // Check if the imported trip's ID already exists
          const existingIds = new Set(prev.trips.map((t) => t.id))
          const importedTrip = existingIds.has(payload.trip.id)
            ? { ...payload.trip, id: createId() }
            : payload.trip

          return {
            trips: [...prev.trips, importedTrip],
            currentTripId: importedTrip.id,
          }
        }

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
      const skippedMessage =
        skippedStops > 0
          ? ` Skipped ${skippedStops} invalid stop${skippedStops === 1 ? '' : 's'}.`
          : ''
      setImportStatus(
        `Imported ${sanitizedStops.length} stop${
          sanitizedStops.length === 1 ? '' : 's'
        }.${skippedMessage}`
      )
      setPendingImport(null)
    },
    [mergeStops],
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
          const { payload, skippedStops, totalStops } = parseDriveTripPayload(raw, {
            allowedSourceNames,
          })
          const sanitizedStops: TripStop[] = payload.trip.stops

          if (totalStops > 0 && sanitizedStops.length === 0) {
            throw new Error('No valid stops found')
          }

          if (!currentTrip) {
            completeImport(payload, skippedStops, totalStops, 'new')
            return
          }

          setPendingImport({ payload, skippedStops, totalStops })
          setImportStatus('')
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
    [allowedSourceNames, completeImport, currentTrip],
  )

  const handleConfirmMergeImport = useCallback(() => {
    if (!pendingImport) return
    completeImport(
      pendingImport.payload,
      pendingImport.skippedStops,
      pendingImport.totalStops,
      'merge',
    )
  }, [completeImport, pendingImport])

  const handleConfirmNewImport = useCallback(() => {
    if (!pendingImport) return
    completeImport(
      pendingImport.payload,
      pendingImport.skippedStops,
      pendingImport.totalStops,
      'new',
    )
  }, [completeImport, pendingImport])

  const handleCancelImport = useCallback(() => {
    setPendingImport(null)
    setImportStatus('')
    setImportError('Import canceled.')
  }, [])

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
    // Clear current stop when switching trips
    setCurrentStopId(null)
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
    // Clear current stop for new trip
    setCurrentStopId(null)
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

  const handleStopHover = useCallback((stopId: string | null) => {
    setCurrentStopId(stopId)
  }, [])

  const handleStopDoubleClick = useCallback((stopId: string) => {
    setCurrentStopId(stopId)
    
    // Scroll to stop in timeline and highlight it
    // Use specific selector to target timeline stop-item, not marker
    const stopElement = document.querySelector(`.stop-item[data-stop-id="${stopId}"]`)
    if (stopElement) {
      setTimeout(() => {
        stopElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 0)
    }
  }, [])

  const handleScrollToMap = useCallback(() => {
    const mapPanel = document.querySelector('.panel-map')
    if (mapPanel) {
      mapPanel.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  const handleAddStop = useCallback(() => {
    // Scroll to top smoothly
    window.scrollTo({ top: 0, behavior: 'smooth' })
    // Open the drawer for adding a new stop
    setTimeout(() => {
      tripFormRef.current?.openAddDrawer()
    }, 300)
  }, [])

  const handleRequestDeleteTrip = useCallback((tripId: string) => {
    setPendingDeleteTripId(tripId)
  }, [])

  const handleRenameTrip = useCallback((tripId: string, newName: string) => {
    setTripsState((prev) => {
      const tripIndex = prev.trips.findIndex((t) => t.id === tripId)
      if (tripIndex === -1) return prev

      const updatedTrips = [...prev.trips]
      updatedTrips[tripIndex] = {
        ...updatedTrips[tripIndex],
        name: newName,
        updatedAt: new Date().toISOString(),
      }

      return {
        ...prev,
        trips: updatedTrips,
      }
    })
  }, [])

  const handleConfirmDeleteTrip = useCallback(() => {
    if (!pendingDeleteTripId) return

    setTripsState((prev) => {
      const remainingTrips = prev.trips.filter((t) => t.id !== pendingDeleteTripId)
      if (remainingTrips.length === 0) {
        return {
          trips: [],
          currentTripId: null,
        }
      }

      const newCurrentTripId =
        prev.currentTripId === pendingDeleteTripId ? remainingTrips[0].id : prev.currentTripId

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
    // Clear current stop when deleting trip
    setCurrentStopId(null)
    // Close the modal
    setPendingDeleteTripId(null)
  }, [pendingDeleteTripId])

  const handleCancelDeleteTrip = useCallback(() => {
    setPendingDeleteTripId(null)
  }, [])

  // Scroll detection for map visibility
  useEffect(() => {
    const mapPanel = document.querySelector('.panel-map')
    if (!mapPanel) return

    mapPanelRef.current = mapPanel as HTMLElement

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsMapVisible(entry.isIntersecting)
        })
      },
      {
        threshold: 0.1,
        rootMargin: '-100px 0px 0px 0px',
      }
    )

    observer.observe(mapPanel)

    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    if (geocodingInFlight.current) {
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
          const result = await geocodeAddress(stop.address)
          if (cancelled) {
            return
          }

          if (!result?.location) {
            // For manual entries, don't show error status
            // They're allowed to have no coordinates
            updateStop(stop.id, { 
              status: stop.manualEntry ? 'idle' : 'error' 
            })
            continue
          }

          updateStop(stop.id, {
            location: result.location,
            status: 'ready',
          })
        } catch (error) {
          console.error('Geocoding error:', error)
          if (!cancelled) {
            // For manual entries, don't show error status
            updateStop(stop.id, { 
              status: stop.manualEntry ? 'idle' : 'error' 
            })
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
  }, [currentStops, updateStop])

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

  // Calculate distances for all consecutive stop pairs
  useEffect(() => {
    if (!currentTrip || currentStops.length < 2 || !routesEnabled) {
      return
    }

    // Prevent concurrent distance calculations for the same trip
    if (distanceCalculationInFlight.current) {
      return
    }

    // Check if locations have actually changed
    const currentLocationsHash = currentStops
      .map((stop) =>
        stop.location ? `${stop.location.lat},${stop.location.lng}` : 'none'
      )
      .join('|')
    
    if (currentLocationsHash === previousLocationsRef.current) {
      return
    }

    const stopsNeedingDistance = currentStops.some(
      (stop) => stop.location && !stop.distanceFromPreviousMeters
    )

    if (!stopsNeedingDistance) {
      previousLocationsRef.current = currentLocationsHash
      return
    }

    previousLocationsRef.current = currentLocationsHash
    distanceCalculationInFlight.current = true

    const calculateDistancesAsync = async () => {
      try {
        const updatedStops = await calculateTripDistances(currentStops)
        
        // Update trip with new distance data
        setTripsState((prev) => {
          const tripIndex = prev.trips.findIndex(
            (t) => t.id === prev.currentTripId
          )
          if (tripIndex === -1) return prev

          const updatedTrips = [...prev.trips]
          updatedTrips[tripIndex] = {
            ...updatedTrips[tripIndex],
            stops: updatedStops,
            updatedAt: new Date().toISOString(),
          }

          return {
            ...prev,
            trips: updatedTrips,
          }
        })
      } catch (error) {
        console.error('Error calculating distances:', error)
      } finally {
        distanceCalculationInFlight.current = false
      }
    }

    void calculateDistancesAsync()
  }, [currentTrip, currentStops, routesEnabled])

  // Create a stable key for cost calculation trigger
  // Only changes when stops with distances change or MPG changes
  const costCalculationKey = useMemo(() => {
    return {
      tripId: currentTrip?.id,
      stopDistances: currentStops
        .map((stop) => stop.distanceFromPreviousMeters ?? 'none')
        .join('|'),
      mpg: debouncedMpg,
    }
  }, [currentTrip?.id, currentStops, debouncedMpg])

  // Extract start state for gas price lookup
  const startState = useMemo(() => {
    if (!currentStops.length) return null

    const firstStop = currentStops[0]
    if (!firstStop.location) return null

    // Try to extract state from address
    const addressParts = firstStop.address.split(',')
    if (addressParts.length >= 2) {
      const statePart = addressParts[addressParts.length - 2].trim()
      // Extract state code (e.g., "NC" from "NC 28110")
      const stateMatch = statePart.match(/[A-Z]{2}/)
      return stateMatch ? stateMatch[0] : null
    }

    return null
  }, [currentStops])

  // Fetch gas price for the trip's start state
  useEffect(() => {
    if (!startState || gasPriceInFlight.current.has(startState)) {
      return
    }

    gasPriceInFlight.current.add(startState)

    gasPriceService
      .getPriceForState(startState)
      .then((priceResult) => {
        setGasPriceByState((prev) => ({
          ...prev,
          [startState]: priceResult,
        }))
      })
      .catch((error) => {
        console.error(`Error fetching gas price for ${startState}:`, error)
        // Set a cached error result so we don't retry repeatedly
        setGasPriceByState((prev) => ({
          ...prev,
          [startState]: {
            state: startState,
            pricePerGallon: 0,
            source: 'Error',
            fetchedAt: new Date().toISOString(),
            error: 'Failed to fetch gas price',
          },
        }))
      })
      .finally(() => {
        gasPriceInFlight.current.delete(startState)
      })
  }, [startState])

  // Calculate fuel costs when we have all required data
  useEffect(() => {
    if (!currentTrip || !startState) {
      return
    }

    const gasPrice = gasPriceByState[startState]
    if (!gasPrice || !gasPrice.pricePerGallon || gasPrice.pricePerGallon <= 0) {
      return
    }

    // Check if any stop actually has a distance that needs cost calculation
    const hasUncalculatedCosts = currentTrip.stops.some(
      (stop) =>
        stop.distanceFromPreviousMeters &&
        stop.estimatedFuelCost === undefined
    )

    // Check if MPG has changed
    const mpgChanged = previousMpgRef.current !== debouncedMpg
    if (mpgChanged) {
      previousMpgRef.current = debouncedMpg
    }

    // Skip if no uncalculated costs AND MPG didn't change
    if (!hasUncalculatedCosts && !mpgChanged) {
      return
    }

    // Calculate costs for all stops
    const updatedStops = calculateStopCosts(
      currentTrip.stops,
      debouncedMpg,
      gasPrice.pricePerGallon
    )

    // Only update if costs actually changed
    const costChanged = updatedStops.some((stop, idx) => {
      const original = currentTrip.stops[idx]
      return stop.estimatedFuelCost !== original?.estimatedFuelCost
    })

    if (!costChanged) {
      return
    }

    // Update trip with costs
    setTripsState((prev) => {
      const tripIndex = prev.trips.findIndex(
        (t) => t.id === prev.currentTripId
      )
      if (tripIndex === -1) return prev

      const updatedTrips = [...prev.trips]
      updatedTrips[tripIndex] = {
        ...updatedTrips[tripIndex],
        stops: updatedStops,
        updatedAt: new Date().toISOString(),
      }

      return {
        ...prev,
        trips: updatedTrips,
      }
    })
  }, [costCalculationKey, startState, gasPriceByState, currentTrip, debouncedMpg])

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-intro">
          <div className="hero-header">
            <div className="brand">
              <img
                className="brand-logo"
                src="/brand/rv-icon.svg"
                alt="RV Trip Planner logo"
                width={48}
                height={48}
                loading="lazy"
              />
              <div className="brand-text">
                <p className="eyebrow">RV Trip Planner</p>
                <h1>Route, schedule, and weather in one place.</h1>
              </div>
            </div>
            <ThemeToggle />
          </div>
          <p className="hero-subtitle">
            Add each stop with dates, and the planner will map your route and
            pull forecasts for the days you are there.
          </p>
          <div className="trip-selector-wrapper">
            <TripSelector
              tripsState={tripsState}
              onSelectTrip={handleSelectTrip}
              onCreateTrip={handleCreateTrip}
              onRequestDelete={handleRequestDeleteTrip}
              onRenameTrip={handleRenameTrip}
            />
          </div>
          <div className="hero-tabs" role="tablist" aria-label="Quick actions">
            <button
              className={`hero-tab${heroTab === 'actions' ? ' hero-tab--active' : ''}`}
              type="button"
              role="tab"
              aria-selected={heroTab === 'actions'}
              onClick={() => setHeroTab('actions')}
            >
              Trip actions
            </button>
            <button
              className={`hero-tab${heroTab === 'drive' ? ' hero-tab--active' : ''}`}
              type="button"
              role="tab"
              aria-selected={heroTab === 'drive'}
              onClick={() => setHeroTab('drive')}
            >
              Drive sync
            </button>
          </div>
          {heroTab === 'actions' ? (
            <div className="hero-actions">
              <button className="ghost" type="button" onClick={exportTrips}>
                💾 Save trip
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
                📂 Load trip
              </button>
              <button
                className="ghost"
                type="button"
                onClick={exportCalendar}
                disabled={currentStops.length === 0}
              >
                📅 Export to Calendar
              </button>
              <button
                className="ghost"
                type="button"
                onClick={() => void exportTripPdf()}
                disabled={currentStops.length === 0}
              >
                Print / PDF
              </button>
              <button
                className="ghost"
                type="button"
                onClick={() => setShowVehicleSettings(true)}
              >
                ⛽ Vehicle Settings
              </button>
              {importStatus ? (
                <span className="import-status">{importStatus}</span>
              ) : null}
              {importError ? <span className="import-error">{importError}</span> : null}
              {printStatus ? (
                <span className="import-status">{printStatus}</span>
              ) : null}
              {printError ? <span className="import-error">{printError}</span> : null}
            </div>
          ) : (
            <div className="hero-actions hero-actions--drive">
              <DriveSyncControls
                authStatus={driveSync.authStatus}
                syncStatus={driveSync.syncStatus}
                lastSyncAt={driveSync.lastSyncAt}
                error={driveSync.error}
                isOnline={driveSync.isOnline}
                hasClientId={driveSync.hasClientId}
                gisReady={driveSync.gisReady}
                userInfo={driveSync.userInfo}
                onSignIn={driveSync.signIn}
                onSignOut={driveSync.signOut}
                onSyncNow={driveSync.syncNow}
              />
            </div>
          )}
        </div>
        <div className="hero-card">
          <div className="hero-card-row">
            <span>Stops</span>
            <strong>{currentStops.length}</strong>
          </div>
          <div className="hero-card-row">
            <span>Maps</span>
            <strong>OpenStreetMap</strong>
          </div>
          <div className="hero-card-row">
            <span>Weather</span>
            <strong>Hybrid (NOAA+Climate)</strong>
          </div>
          <div className="hero-card-row">
            <span>Total Distance</span>
            <strong>
              {tripTotalDistanceMeters > 0 ? formatDistance(tripTotalDistanceMeters) : 'N/A'}
            </strong>
          </div>
          <div className="hero-card-row">
            <span>Estimated Fuel Cost</span>
            <strong>
              {tripTotalFuelCost > 0 ? `$${tripTotalFuelCost.toFixed(2)}` : 'Data not available'}
            </strong>
          </div>
        </div>
      </header>

      <main className="grid">
        <section className="panel panel-form">
          <TripForm
            ref={tripFormRef}
            stops={currentStops}
            onAddStop={addStop}
            onRemoveStop={removeStop}
            onUpdateStop={updateStop}
            onReorderStop={reorderStops}
            weatherByStopId={weatherByStopId}
            weatherErrors={weatherErrors}
            selectedStopIds={selectedStopIds}
            onToggleStopSelection={toggleStopSelection}
            onSelectAllStops={selectAllStops}
            onClearStopSelection={clearStopSelection}
            mapBounds={mapBounds}
            currentStopId={currentStopId}
          />
        </section>

        <section className="panel panel-map">
          <TripMap
            stops={currentStops}
            onBoundsChange={setMapBounds}
            onStopHover={handleStopHover}
            onStopDoubleClick={handleStopDoubleClick}
          />
        </section>
      </main>

      <VehicleSettingsModal
        isOpen={showVehicleSettings}
        gasPrice={startState ? gasPriceByState[startState] : undefined}
        onClose={() => setShowVehicleSettings(false)}
      />
      <ImportTripModal
        isOpen={Boolean(pendingImport)}
        tripName={pendingImport?.payload.trip.name ?? 'Imported trip'}
        stopCount={pendingImport?.payload.trip.stops.length ?? 0}
        skippedStops={pendingImport?.skippedStops ?? 0}
        onMerge={handleConfirmMergeImport}
        onCreateNew={handleConfirmNewImport}
        onCancel={handleCancelImport}
      />
      <UnifiedConflictModal
        conflicts={driveSync.conflicts}
        onResolve={driveSync.resolveConflictsBatch}
      />
      <DeleteTripModal
        isOpen={Boolean(pendingDeleteTripId)}
        tripName={
          pendingDeleteTripId
            ? tripsState.trips.find((t) => t.id === pendingDeleteTripId)?.name ?? 'Unknown trip'
            : ''
        }
        stopCount={
          pendingDeleteTripId
            ? tripsState.trips.find((t) => t.id === pendingDeleteTripId)?.stops.length ?? 0
            : 0
        }
        onConfirm={handleConfirmDeleteTrip}
        onCancel={handleCancelDeleteTrip}
      />
      <FloatingActionButtons
        onAddStop={handleAddStop}
        onScrollToMap={handleScrollToMap}
        showScrollToMap={!isMapVisible}
      />
    </div>
  )
}

export default App
