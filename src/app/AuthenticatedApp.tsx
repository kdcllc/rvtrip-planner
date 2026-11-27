import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { OPENROUTE_API_KEY } from '../config/env'
import { TripMap } from '../features/map/TripMap'
import { TripForm, type TripFormRef } from '../features/trip/TripForm'
import type { Trip, TripStop, TripsState } from '../domain/trip/types'
import type { VersionedTrip } from '../types/api'
import { TripSelector } from '../features/trip/TripSelector'
import { VehicleSettingsModal } from '../features/trip/VehicleSettingsModal'
import {
  fetchStopForecast,
  makeForecastCacheKey,
} from '../services/weather/weatherService'
import type { StopForecast } from '../domain/weather/types'
import {
  loadTrips,
  saveTrip,
  deleteTrip,
  saveTripSelection,
  importTrips,
  readLegacyLocalTrips,
  clearLegacyLocalTrips,
  createNewTrip,
  getCurrentTrip,
} from '../services/storage/tripStorage'
import { useAuth } from '../hooks/useAuth'
import type { MapBounds } from '../services/campsiteSearch'
import {
  generateICalendar,
  downloadICalendar,
} from '../services/calendar/calendarService'
import { gasPriceService } from '../services/gas/gasPriceService'
import { calculateTripDistances, formatDistance } from '../utils/distance'
import {
  calculateStopCosts,
  calculateTripTotalAccommodationCost,
  calculateTripTotalActualCost,
  calculateTripTotalActualGasCost,
  calculateTripTotalActualFoodCost,
  calculateTripTotalActualMiscCost,
} from '../utils/costCalculation'
import { buildTripPrintStops, calculateTotalDistanceMeters } from '../utils/print'
import { useVehicleSettingsContext } from '../hooks/useVehicleSettings'
import type { GasPriceLookupResult } from '../domain/gas/types'
import {
  buildTripFilePayload,
  buildTripsBackupPayload,
  createBackupFileName,
  createTripFileName,
} from '../services/tripFile/tripFile'
import { geocodeAddress } from '../services/geocoding/geocodingService'
import { ImportTripModal } from '../components/common/ImportTripModal'
import { VersionLabel } from '../components/common/VersionLabel'
import { FloatingActionButtons } from '../components/common/FloatingActionButtons'
import { DeleteTripModal } from '../components/common/DeleteTripModal'
import { ThemeToggle } from '../components/common/ThemeToggle'
import { AccessRequestsPanel } from '../features/admin/AccessRequestsPanel'
import { downloadTripPdf } from '../services/print/printTripPdf'
import type { TripPrintData } from '../domain/trip/print'
import { useRoutesEnabled } from '../hooks/useRoutesEnabled'
import { createOpenSourceRoutingProvider } from '../services/maps/openSourceRouting'
import { setRoutingProvider } from '../services/maps/routesService'
import { getRelevantStopIdForDate } from '../utils/date'
import { mergeServerTrips } from '../domain/trip/syncMerge'

const getTodayKey = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

type PlannerProps = {
  initialState: TripsState
  /** Server version per trip id (every trip in initialState is already persisted). */
  initialVersions: Record<string, number>
  /** The current-trip id the server already knows about. */
  savedSelection: string | null
  notice: string
  isAdmin: boolean
  onSessionExpired: () => void | Promise<void>
  onSignOut: () => void | Promise<void>
  userEmail: string | null
}

type SaveBanner =
  | { kind: 'none' }
  | { kind: 'waking' }
  | { kind: 'retrying' }
  | { kind: 'error'; message: string }

type FlushOutcome = 'session-expired' | undefined

const SAVE_DEBOUNCE_MS = 800
const RETRY_BASE_MS = 5000
const RETRY_MAX_MS = 60000
const AUTO_SYNC_MIN_INTERVAL_MS = 30000

const downloadJsonFile = (payload: unknown, fileName: string) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function Planner({
  initialState,
  initialVersions,
  savedSelection,
  notice,
  isAdmin,
  onSessionExpired,
  onSignOut,
  userEmail,
}: PlannerProps) {
  const [tripsState, setTripsState] = useState<TripsState>(initialState)
  const [saveBanner, setSaveBanner] = useState<SaveBanner>({ kind: 'none' })
  const [conflicts, setConflicts] = useState<Record<string, VersionedTrip | null>>({})
  const [hasUnsaved, setHasUnsaved] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [showImportModal, setShowImportModal] = useState(false)
  const [showAccessRequests, setShowAccessRequests] = useState(false)
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
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [selectedStopIds, setSelectedStopIds] = useState<Set<string>>(new Set())
  const [mapBounds, setMapBounds] = useState<MapBounds | undefined>()
  const [currentStopId, setCurrentStopId] = useState<string | null>(null)
  const [previewStopId, setPreviewStopId] = useState<string | null>(null)
  const [mapFocusRequest, setMapFocusRequest] = useState<{
    stopId: string
    nonce: number
  } | null>(null)
  const [showVehicleSettings, setShowVehicleSettings] = useState(false)
  const [isMapVisible, setIsMapVisible] = useState(true)
  const [pendingDeleteTripId, setPendingDeleteTripId] = useState<string | null>(null)
  const [todayKey, setTodayKey] = useState(getTodayKey)
  const geocodingInFlight = useRef(false)
  const mapPanelRef = useRef<HTMLElement | null>(null)
  const tripFormRef = useRef<TripFormRef>(null)
  const weatherInFlight = useRef<Set<string>>(new Set())
  const gasPriceInFlight = useRef<Set<string>>(new Set())
  const distanceCalculationInFlight = useRef(false)
  const lastAutoFocusSignatureRef = useRef('')
  const previousLocationsRef = useRef<string>('')
  const previousMpgRef = useRef<number | null>(null)
  const { debouncedMpg } = useVehicleSettingsContext()
  const [routesEnabled] = useRoutesEnabled()

  useEffect(() => {
    const provider = createOpenSourceRoutingProvider({
      openRouteServiceApiKey: OPENROUTE_API_KEY || undefined,
    })
    setRoutingProvider(provider)
  }, [])

  useEffect(() => {
    const now = new Date()
    const msUntilMidnight =
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime()
    const timeout = setTimeout(() => setTodayKey(getTodayKey()), msUntilMidnight)
    return () => clearTimeout(timeout)
  }, [todayKey])

  const currentTrip = getCurrentTrip(tripsState)
  const currentStops = useMemo(() => currentTrip?.stops ?? [], [currentTrip])
  const preferredStopId = useMemo(
    () => getRelevantStopIdForDate(currentStops, new Date()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- todayKey is intentional: the memo reads new Date(), so it must recompute when the day rolls over
    [currentStops, todayKey]
  )
  const stopDateSignature = useMemo(() => {
    if (!currentTrip) {
      return ''
    }

    return `${currentTrip.id}|${currentStops
      .map((stop) => `${stop.id}:${stop.startDate}:${stop.endDate}`)
      .join('|')}`
  }, [currentStops, currentTrip])

  useEffect(() => {
    if (!currentTrip) {
      lastAutoFocusSignatureRef.current = ''
      if (currentStopId !== null) {
        setCurrentStopId(null)
      }
      return
    }

    const hasSelectedStop = currentStops.some((stop) => stop.id === currentStopId)
    const shouldRefreshFocus = lastAutoFocusSignatureRef.current !== stopDateSignature
    lastAutoFocusSignatureRef.current = stopDateSignature

    if (!preferredStopId) {
      if (!hasSelectedStop && currentStopId !== null) {
        setCurrentStopId(null)
      }
      return
    }

    if (shouldRefreshFocus || !hasSelectedStop || currentStopId === null) {
      if (currentStopId !== preferredStopId) {
        setCurrentStopId(preferredStopId)
      }
    }
  }, [currentStopId, currentStops, currentTrip, preferredStopId, stopDateSignature])

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

  const tripTotalActualCost = useMemo(() => {
    return calculateTripTotalActualCost(currentStops)
  }, [currentStops])

  const tripTotalActualGasCost = useMemo(() => {
    return calculateTripTotalActualGasCost(currentStops)
  }, [currentStops])

  const tripTotalActualFoodCost = useMemo(() => {
    return calculateTripTotalActualFoodCost(currentStops)
  }, [currentStops])

  const tripTotalActualMiscCost = useMemo(() => {
    return calculateTripTotalActualMiscCost(currentStops)
  }, [currentStops])

  const tripFuelDelta = useMemo(() => {
    return Math.round((tripTotalActualGasCost - tripTotalFuelCost) * 100) / 100
  }, [tripTotalActualGasCost, tripTotalFuelCost])

  const formatDeltaCurrency = (value: number): string => {
    if (value > 0) {
      return `+$${value.toFixed(2)}`
    }
    if (value < 0) {
      return `-$${Math.abs(value).toFixed(2)}`
    }
    return '$0.00'
  }

  // Per-trip auto-save. A trip is "dirty" while its object differs from the last object the
  // server confirmed; dirty trips, pending deletes and selection changes are flushed after a
  // debounce and RETRIED until they succeed (database waking, network blips). Never silent.
  const versionsRef = useRef<Record<string, number>>({ ...initialVersions })
  const savedTripsRef = useRef<Map<string, Trip>>(
    new Map(initialState.trips.map((trip) => [trip.id, trip])),
  )
  const pendingDeletesRef = useRef<Set<string>>(new Set())
  const savedSelectionRef = useRef<string | null>(savedSelection)
  const conflictsRef = useRef<Record<string, VersionedTrip | null>>({})
  const latestStateRef = useRef<TripsState>(initialState)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryAttemptRef = useRef(0)
  const inFlightRef = useRef<Promise<FlushOutcome> | null>(null)
  const flushRef = useRef<() => Promise<FlushOutcome>>(async () => undefined)
  const unmountedRef = useRef(false)
  const onSessionExpiredRef = useRef(onSessionExpired)
  useEffect(() => {
    onSessionExpiredRef.current = onSessionExpired
  }, [onSessionExpired])

  const hasDirtyTrips = useCallback(
    () =>
      pendingDeletesRef.current.size > 0 ||
      latestStateRef.current.trips.some((trip) => savedTripsRef.current.get(trip.id) !== trip),
    [],
  )
  const needsSave = useCallback(
    () => hasDirtyTrips() || latestStateRef.current.currentTripId !== savedSelectionRef.current,
    [hasDirtyTrips],
  )

  const runFlush = useCallback(async (): Promise<FlushOutcome> => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    let retry = false
    let waking = false
    let retryAfterMs: number | undefined
    let hardError = ''
    const failRetry = (result: { kind: string; retryAfterSeconds?: number }) => {
      retry = true
      if (result.kind === 'database-waking') {
        waking = true
        if (result.retryAfterSeconds !== undefined) retryAfterMs = result.retryAfterSeconds * 1000
      }
    }
    const expired = (): FlushOutcome => {
      if (!unmountedRef.current) void onSessionExpiredRef.current()
      return 'session-expired'
    }

    for (const id of [...pendingDeletesRef.current]) {
      const result = await deleteTrip(id)
      if (result.kind === 'saved') {
        pendingDeletesRef.current.delete(id)
        delete versionsRef.current[id]
        savedTripsRef.current.delete(id)
      } else if (result.kind === 'session-expired') {
        return expired()
      } else {
        failRetry(result)
        break
      }
    }

    if (!retry) {
      const dirtyTrips = latestStateRef.current.trips.filter(
        (trip) => savedTripsRef.current.get(trip.id) !== trip && !(trip.id in conflictsRef.current),
      )
      for (const trip of dirtyTrips) {
        const result = await saveTrip(trip, versionsRef.current[trip.id] ?? null)
        if (result.kind === 'saved') {
          versionsRef.current[trip.id] = result.version
          savedTripsRef.current.set(trip.id, trip)
        } else if (result.kind === 'conflict') {
          conflictsRef.current = { ...conflictsRef.current, [trip.id]: result.current }
          if (!unmountedRef.current) setConflicts(conflictsRef.current)
        } else if (result.kind === 'session-expired') {
          return expired()
        } else if (result.kind === 'database-waking' || result.retryable) {
          failRetry(result)
          break
        } else {
          hardError = result.message
        }
      }
    }

    if (!retry) {
      const selection = latestStateRef.current.currentTripId
      if (selection !== savedSelectionRef.current) {
        const result = await saveTripSelection(selection)
        if (result.kind === 'session-expired') return expired()
        if (result.kind === 'database-waking') {
          failRetry(result)
        } else {
          // Best-effort: a non-retryable selection failure is not worth looping on.
          savedSelectionRef.current = selection
        }
      }
    }

    if (unmountedRef.current) return undefined
    setHasUnsaved(hasDirtyTrips())
    if (retry) {
      const attempt = retryAttemptRef.current
      retryAttemptRef.current += 1
      const delay = Math.min(retryAfterMs ?? RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS)
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null
        void flushRef.current()
      }, delay)
      setSaveBanner({ kind: waking ? 'waking' : 'retrying' })
    } else {
      retryAttemptRef.current = 0
      setSaveBanner(hardError ? { kind: 'error', message: hardError } : { kind: 'none' })
    }
    return undefined
  }, [hasDirtyTrips])

  // Serialises flushes: a caller arriving mid-flush waits, then runs its own pass.
  const flush = useCallback(async (): Promise<FlushOutcome> => {
    while (inFlightRef.current) await inFlightRef.current
    const run = runFlush().catch((): FlushOutcome => {
      if (!unmountedRef.current) {
        setSaveBanner({ kind: 'error', message: 'Could not save your trips.' })
      }
      return undefined
    })
    inFlightRef.current = run
    try {
      return await run
    } finally {
      if (inFlightRef.current === run) inFlightRef.current = null
    }
  }, [runFlush])

  useEffect(() => {
    flushRef.current = flush
  }, [flush])

  // Sign out: flush any unsaved work BEFORE logging out (the cookie dies with logout).
  const handleSignOutClick = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    if (needsSave()) {
      const outcome = await flush()
      if (outcome === 'session-expired') return
    }
    await onSignOut()
  }, [flush, needsSave, onSignOut])

  useEffect(() => {
    latestStateRef.current = tripsState
    setHasUnsaved(hasDirtyTrips())
    if (!needsSave()) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      void flush()
    }, SAVE_DEBOUNCE_MS)
  }, [tripsState, flush, hasDirtyTrips, needsSave])

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        void flushRef.current()
      }
    }
  }, [])

  // Warn before leaving the page while edits or deletes are not yet confirmed saved.
  useEffect(() => {
    if (!hasUnsaved) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsaved])

  const clearConflict = useCallback((tripId: string) => {
    const { [tripId]: _removed, ...rest } = conflictsRef.current
    void _removed
    conflictsRef.current = rest
    setConflicts(rest)
  }, [])

  const handleKeepMine = useCallback(
    (tripId: string) => {
      const current = conflictsRef.current[tripId] ?? null
      if (current) versionsRef.current[tripId] = current.version
      else delete versionsRef.current[tripId]
      clearConflict(tripId)
      void flush()
    },
    [clearConflict, flush],
  )

  const handleLoadSaved = useCallback(
    (tripId: string) => {
      const current = conflictsRef.current[tripId] ?? null
      clearConflict(tripId)
      if (current) {
        versionsRef.current[tripId] = current.version
        savedTripsRef.current.set(tripId, current.trip)
        setTripsState((prev) =>
          prev.trips.some((trip) => trip.id === tripId)
            ? { ...prev, trips: prev.trips.map((trip) => (trip.id === tripId ? current.trip : trip)) }
            : { ...prev, trips: [...prev.trips, current.trip] },
        )
      } else {
        delete versionsRef.current[tripId]
        savedTripsRef.current.delete(tripId)
        setTripsState((prev) => {
          const trips = prev.trips.filter((trip) => trip.id !== tripId)
          const currentTripId =
            prev.currentTripId === tripId ? (trips[0]?.id ?? null) : prev.currentTripId
          return { trips, currentTripId }
        })
      }
    },
    [clearConflict],
  )

  const syncRunningRef = useRef(false)
  const lastSyncAtRef = useRef(0)

  const syncTrips = useCallback(
    async (mode: 'manual' | 'auto'): Promise<void> => {
      if (syncRunningRef.current) return
      syncRunningRef.current = true
      if (!unmountedRef.current) {
        setIsSyncing(true)
        if (mode === 'manual') setSyncMessage('')
      }
      const report = (message: string) => {
        if (!unmountedRef.current) setSyncMessage(message)
      }
      try {
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
        }
        const outcome = await flush()
        if (outcome === 'session-expired') return
        if (mode === 'auto' && needsSave()) return

        const snapshot = latestStateRef.current
        let result = await loadTrips()
        for (let wake = 0; result.kind === 'database-waking' && wake < MAX_WAKE_RETRIES; wake += 1) {
          const delay = Math.min(
            (result.retryAfterSeconds ?? DEFAULT_WAKE_DELAY_MS / 1000) * 1000,
            MAX_WAKE_DELAY_MS,
          )
          await new Promise<void>((resolve) => setTimeout(resolve, delay))
          if (unmountedRef.current) return
          result = await loadTrips()
        }
        if (unmountedRef.current) return

        if (result.kind === 'session-expired') {
          void onSessionExpiredRef.current()
          return
        }
        if (result.kind === 'database-waking') {
          if (mode === 'manual') report('The database is still waking up. Please try again.')
          return
        }
        if (result.kind === 'error') {
          if (mode === 'manual') report(result.message)
          return
        }

        if (latestStateRef.current !== snapshot) {
          if (mode === 'manual') report('Your trips changed while syncing — press Sync again.')
          return
        }
        const merged = mergeServerTrips({
          local: latestStateRef.current,
          savedTrips: savedTripsRef.current,
          versions: versionsRef.current,
          pendingDeletes: pendingDeletesRef.current,
          server: { trips: result.trips, currentTripId: result.currentTripId },
        })
        versionsRef.current = merged.versions
        savedTripsRef.current = merged.savedTrips
        savedSelectionRef.current =
          merged.state.currentTripId !== null &&
          result.currentTripId === merged.state.currentTripId
            ? merged.state.currentTripId
            : result.currentTripId
        conflictsRef.current = {}
        setConflicts({})
        setTripsState(merged.state)

        if (merged.overwritten.length > 0) {
          report(
            `Server copy kept for: ${merged.overwritten.join(', ')}. Edits to these trips on this device were not saved.`,
          )
        } else if (mode === 'manual') {
          report(
            `Synced at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
          )
        }
      } finally {
        syncRunningRef.current = false
        lastSyncAtRef.current = Date.now()
        if (!unmountedRef.current) setIsSyncing(false)
      }
    },
    [flush, needsSave],
  )

  // Auto-sync when the tab regains focus. Never on mount, never from timers, and only when
  // nothing is unsaved, no flush/conflict/sync is active, and 30 s have passed.
  useEffect(() => {
    lastSyncAtRef.current = Date.now()
    const maybeAutoSync = () => {
      if (syncRunningRef.current || inFlightRef.current !== null) return
      if (needsSave() || Object.keys(conflictsRef.current).length > 0) return
      if (Date.now() - lastSyncAtRef.current < AUTO_SYNC_MIN_INTERVAL_MS) return
      void syncTrips('auto')
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') maybeAutoSync()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', maybeAutoSync)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', maybeAutoSync)
    }
  }, [needsSave, syncTrips])

  const addStop = useCallback(
    (stop: TripStop) => {
      if (!currentTrip) return

      setTripsState((prev) => {
        const tripIndex = prev.trips.findIndex((t) => t.id === prev.currentTripId)
        if (tripIndex === -1) return prev

        const updatedTrips = [...prev.trips]
        const trip = updatedTrips[tripIndex]

        // Keep starting points at the beginning, sort others chronologically
        const startingPoints = trip.stops.filter((s) => s.label === 'Starting point')
        const otherStops = trip.stops.filter((s) => s.label !== 'Starting point')
        
        // Add new stop and sort by date
        const allOtherStops = stop.label === 'Starting point' ? otherStops : [...otherStops, stop]
        
        // Sort stops chronologically by startDate
        // Stops without dates go to the end
        allOtherStops.sort((a, b) => {
          if (!a.startDate && !b.startDate) return 0
          if (!a.startDate) return 1
          if (!b.startDate) return -1
          return a.startDate.localeCompare(b.startDate)
        })
        
        const newStops =
          stop.label === 'Starting point'
            ? [stop, ...allOtherStops]
            : [...startingPoints, ...allOtherStops]

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

  const exportTrips = useCallback(() => {
    setImportError('')
    setImportStatus('')

    if (!currentTrip) {
      setImportError('No trip to export. Create a trip first.')
      return
    }

    downloadJsonFile(buildTripFilePayload(currentTrip), createTripFileName(currentTrip))
  }, [currentTrip])

  const exportAllTrips = useCallback(() => {
    setImportError('')
    setImportStatus('')
    if (tripsState.trips.length === 0) return
    downloadJsonFile(buildTripsBackupPayload(tripsState.trips), createBackupFileName())
  }, [tripsState.trips])

  const handleDownloadTrip = useCallback(
    (tripId: string) => {
      const trip = tripsState.trips.find((t) => t.id === tripId)
      if (!trip) return
      downloadJsonFile(buildTripFilePayload(trip), createTripFileName(trip))
    },
    [tripsState.trips],
  )

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
    if (isExportingPdf) {
      return
    }

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

    setIsExportingPdf(true)

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
        totalActualCost: tripTotalActualCost,
        totalActualGasCost: tripTotalActualGasCost,
        totalActualFoodCost: tripTotalActualFoodCost,
        totalActualMiscCost: tripTotalActualMiscCost,
        totalFuelDelta: tripFuelDelta,
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
    } finally {
      setIsExportingPdf(false)
    }
  }, [
    currentTrip,
    isExportingPdf,
    selectedStopIds,
    weatherByStopId,
    tripTotalFuelCost,
    tripTotalAccommodationCost,
    tripTotalActualCost,
    tripTotalActualGasCost,
    tripTotalActualFoodCost,
    tripTotalActualMiscCost,
    tripFuelDelta,
  ])

  // Import file trips into the account (database), then merge them into local state.
  const handleImportTrips = useCallback(
    async (trips: Trip[]): Promise<{ ok: true } | { ok: false; error: string }> => {
      const result = await importTrips(trips)
      if (result.kind === 'session-expired') {
        void onSessionExpiredRef.current()
        return { ok: false, error: 'Your session expired. Please sign in again.' }
      }
      if (result.kind === 'database-waking') {
        return { ok: false, error: 'The database is waking up. Please try again in a few seconds.' }
      }
      if (result.kind === 'error') {
        return { ok: false, error: result.message }
      }
      const importedIds = new Set(result.imported)
      const added = trips.filter((trip) => importedIds.has(trip.id))
      for (const trip of added) {
        versionsRef.current[trip.id] = 1
        savedTripsRef.current.set(trip.id, trip)
      }
      if (added.length > 0) {
        setTripsState((prev) => {
          const known = new Set(prev.trips.map((trip) => trip.id))
          const fresh = added.filter((trip) => !known.has(trip.id))
          return { trips: [...prev.trips, ...fresh], currentTripId: added[0].id }
        })
        setWeatherByStopId({})
        setWeatherErrors({})
        setSelectedStopIds(new Set())
        setCurrentStopId(null)
      }
      const skippedCount = result.skipped.length
      setImportError('')
      setImportStatus(
        `Imported ${added.length} trip${added.length === 1 ? '' : 's'}.` +
          (skippedCount > 0 ? ` ${skippedCount} already in your account ${skippedCount === 1 ? 'was' : 'were'} skipped.` : ''),
      )
      return { ok: true }
    },
    [],
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

  const handleSelectStop = useCallback((stopId: string) => {
    setCurrentStopId(stopId)
    setPreviewStopId(null)
    setMapFocusRequest((previous) => ({
      stopId,
      nonce: (previous?.nonce ?? 0) + 1,
    }))
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

    // Only trips the server knows about need a DELETE; the flush retries it until it succeeds.
    if (pendingDeleteTripId in versionsRef.current) {
      pendingDeletesRef.current.add(pendingDeleteTripId)
    }
    if (pendingDeleteTripId in conflictsRef.current) clearConflict(pendingDeleteTripId)

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
  }, [pendingDeleteTripId, clearConflict])

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

    // Find stops that need geocoding, prioritizing manual entries
    // Include stops that don't have location yet, excluding those in error state
    const pendingStops = currentStops.filter(
      (stop) =>
        !stop.location && stop.status !== 'error',
    )

    // Sort to prioritize manual entries first (they should be geocoded ASAP)
    const sortedPendingStops = pendingStops.sort((a, b) => {
      const aIsManual = a.manualEntry ? 1 : 0
      const bIsManual = b.manualEntry ? 1 : 0
      return bIsManual - aIsManual // manualEntry: true comes first
    })

    if (sortedPendingStops.length === 0) {
      return
    }

    geocodingInFlight.current = true
    let cancelled = false

    const run = async () => {
      for (const stop of sortedPendingStops) {
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
    // Include stops with location that have date range
    // This will also include manual addresses once they're geocoded
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
              onDownloadTrip={handleDownloadTrip}
            />
          </div>
            <div className="hero-actions">
              <button className="ghost" type="button" onClick={exportTrips}>
                💾 Save trip
              </button>
              <button
                className="ghost"
                type="button"
                onClick={exportAllTrips}
                disabled={tripsState.trips.length === 0}
              >
                ⬇️ Download all trips
              </button>
              <button
                className="ghost"
                type="button"
                onClick={() => setShowImportModal(true)}
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
                disabled={currentStops.length === 0 || isExportingPdf}
                aria-busy={isExportingPdf}
              >
                {isExportingPdf ? (
                  <span className="button-loading">
                    <span className="button-loading-spinner" aria-hidden="true" />
                    Generating PDF...
                  </span>
                ) : (
                  'Print / PDF'
                )}
              </button>
              <button
                className="ghost"
                type="button"
                onClick={() => setShowVehicleSettings(true)}
              >
                ⛽ Vehicle Settings
              </button>
              {isAdmin ? (
                <button
                  className="ghost"
                  type="button"
                  onClick={() => setShowAccessRequests(true)}
                >
                  Access requests
                </button>
              ) : null}
              <button
                className="ghost"
                type="button"
                onClick={() => void handleSignOutClick()}
                title={userEmail ?? undefined}
              >
                Sign out
              </button>
              <button
                className="ghost"
                type="button"
                onClick={() => void syncTrips('manual')}
                disabled={isSyncing}
                aria-busy={isSyncing}
                title="Load your latest trips from the server"
              >
                {isSyncing ? 'Syncing…' : 'Sync'}
              </button>
              {syncMessage ? <span className="import-status" role="status">{syncMessage}</span> : null}
              {notice ? <span className="import-status" role="status">{notice}</span> : null}
              {saveBanner.kind === 'waking' ? (
                <span className="import-status" role="status">
                  Saving… the database is waking up, retrying automatically.
                </span>
              ) : null}
              {saveBanner.kind === 'retrying' ? (
                <span className="import-status" role="status">Could not save yet, retrying…</span>
              ) : null}
              {saveBanner.kind === 'error' ? (
                <span className="import-error" role="alert">
                  {saveBanner.message}{' '}
                  <button className="ghost" type="button" onClick={() => void flush()}>
                    Retry now
                  </button>
                </span>
              ) : null}
              {Object.keys(conflicts).map((tripId) => (
                <span className="import-error" role="alert" key={tripId}>
                  <span>This trip was changed in another tab or device</span>{' '}
                  <strong>
                    {tripsState.trips.find((t) => t.id === tripId)?.name ?? conflicts[tripId]?.trip.name ?? ''}
                  </strong>{' '}
                  <button className="ghost" type="button" onClick={() => handleKeepMine(tripId)}>
                    Keep my version
                  </button>
                  <button className="ghost" type="button" onClick={() => handleLoadSaved(tripId)}>
                    Load saved version
                  </button>
                </span>
              ))}
              {importStatus ? (
                <span className="import-status">{importStatus}</span>
              ) : null}
              {importError ? <span className="import-error">{importError}</span> : null}
              {printStatus ? (
                <span className="import-status">{printStatus}</span>
              ) : null}
              {printError ? <span className="import-error">{printError}</span> : null}
            </div>
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
          <div className="hero-card-row">
            <span>Actual Stop Expenses</span>
            <strong>
              ${tripTotalActualCost.toFixed(2)}
            </strong>
          </div>
          <div className="hero-card-row">
            <span>Actual Gas</span>
            <strong>${tripTotalActualGasCost.toFixed(2)}</strong>
          </div>
          <div className="hero-card-row">
            <span>Actual Food</span>
            <strong>${tripTotalActualFoodCost.toFixed(2)}</strong>
          </div>
          <div className="hero-card-row">
            <span>Actual Misc</span>
            <strong>${tripTotalActualMiscCost.toFixed(2)}</strong>
          </div>
          <div className="hero-card-row">
            <span>Fuel Delta (Est vs Actual)</span>
            <strong>{formatDeltaCurrency(tripFuelDelta)}</strong>
          </div>
        </div>
      </header>

      <main className="grid">
        <section className="panel panel-map">
          <TripMap
            stops={currentStops}
            onBoundsChange={setMapBounds}
            onStopHover={handleStopHover}
            onStopDoubleClick={handleStopDoubleClick}
            highlightStopId={previewStopId ?? currentStopId}
            focusRequest={mapFocusRequest}
          />
        </section>

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
            autoFocusStopId={preferredStopId}
            autoFocusKey={stopDateSignature}
            onCurrentStopChange={handleStopHover}
            onSelectStop={handleSelectStop}
            onPreviewStop={setPreviewStopId}
          />
        </section>
      </main>
      <VersionLabel />

      <VehicleSettingsModal
        isOpen={showVehicleSettings}
        gasPrice={startState ? gasPriceByState[startState] : undefined}
        onClose={() => setShowVehicleSettings(false)}
      />
      <ImportTripModal
        isOpen={showImportModal}
        onImport={handleImportTrips}
        onClose={() => setShowImportModal(false)}
      />
      {isAdmin && showAccessRequests ? (
        <AccessRequestsPanel
          onClose={() => setShowAccessRequests(false)}
          onSessionExpired={() => void onSessionExpiredRef.current()}
        />
      ) : null}
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

const MAX_WAKE_RETRIES = 5
const DEFAULT_WAKE_DELAY_MS = 2000
const MAX_WAKE_DELAY_MS = 5000

// Prevents two overlapping loads from importing the same browser-local trips twice.
let legacyImportRunning = false

type LoadPhase =
  | { kind: 'loading' }
  | { kind: 'waking' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready'
      state: TripsState
      versions: Record<string, number>
      savedSelection: string | null
      notice: string
    }

function AuthenticatedApp() {
  const { user, logout } = useAuth()
  const userId = user?.id ?? null
  const [phase, setPhase] = useState<LoadPhase>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  const handleSignOut = useCallback(async () => {
    let signedOut = false
    try {
      const result = await logout()
      signedOut = result.kind === 'success' || result.kind === 'auth-failure'
    } catch {
      signedOut = false
    }
    // Never hang on "Loading your trips...": fall back to an explicit error state.
    if (!signedOut) {
      setPhase({ kind: 'error', message: 'You have been signed out or your session expired. Please try again.' })
    }
  }, [logout])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const run = async (wakeAttempt: number): Promise<void> => {
      const result = await loadTrips()
      if (cancelled) return

      if (result.kind === 'session-expired') {
        void handleSignOut()
        return
      }
      if (result.kind === 'database-waking') {
        setPhase({ kind: 'waking' })
        if (wakeAttempt < MAX_WAKE_RETRIES) {
          const delay = Math.min(
            (result.retryAfterSeconds ?? DEFAULT_WAKE_DELAY_MS / 1000) * 1000,
            MAX_WAKE_DELAY_MS,
          )
          timer = setTimeout(() => void run(wakeAttempt + 1), delay)
        } else {
          setPhase({ kind: 'error', message: 'The database is still waking up. Please try again.' })
        }
        return
      }
      if (result.kind === 'error') {
        setPhase({ kind: 'error', message: result.message })
        return
      }

      const versions: Record<string, number> = {}
      for (const entry of result.trips) versions[entry.trip.id] = entry.version
      const serverTrips = result.trips.map((entry) => entry.trip)
      const serverCurrent =
        result.currentTripId && serverTrips.some((trip) => trip.id === result.currentTripId)
          ? result.currentTripId
          : (serverTrips[0]?.id ?? null)
      let state: TripsState = { trips: serverTrips, currentTripId: serverCurrent }
      const savedSelection = serverCurrent
      let notice = ''

      // Import browser-local trips on every successful load until one import fully succeeds.
      // Any failure keeps the local keys (retry is safe: the server skips duplicate ids).
      const legacy = legacyImportRunning ? null : readLegacyLocalTrips()
      if (legacy && legacy.trips.length > 0) {
        legacyImportRunning = true
        let imported
        try {
          imported = await importTrips(legacy.trips)
        } finally {
          legacyImportRunning = false
        }
        if (imported.kind === 'imported') {
          clearLegacyLocalTrips()
          if (cancelled) return
          const importedIds = new Set(imported.imported)
          const added = legacy.trips.filter((trip) => importedIds.has(trip.id))
          for (const trip of added) versions[trip.id] = 1
          const known = new Set(serverTrips.map((trip) => trip.id))
          const fresh = added.filter((trip) => !known.has(trip.id))
          const preferred =
            legacy.currentTripId && fresh.some((trip) => trip.id === legacy.currentTripId)
              ? legacy.currentTripId
              : (fresh[0]?.id ?? null)
          state = {
            trips: [...serverTrips, ...fresh],
            currentTripId: serverCurrent ?? preferred,
          }
          const count = added.length
          notice = `Imported ${count} trip${count === 1 ? '' : 's'} from this browser into your account.`
          if (imported.skipped.length > 0) {
            notice += ` ${imported.skipped.length} ${imported.skipped.length === 1 ? 'was' : 'were'} already in your account.`
          }
        } else {
          if (cancelled) return
          if (imported.kind === 'session-expired') {
            void handleSignOut()
            return
          }
          notice = 'Your local trips could not be imported yet; they are still on this device.'
        }
      }
      setPhase({ kind: 'ready', state, versions, savedSelection, notice })
    }

    void run(0).catch((error: unknown) => {
      if (!cancelled) {
        setPhase({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Unable to load trips.',
        })
      }
    })

    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [userId, attempt, handleSignOut])

  if (phase.kind === 'loading') {
    return (
      <div className="app-shell">
        <p role="status">Loading your trips...</p>
      </div>
    )
  }
  if (phase.kind === 'waking') {
    return (
      <div className="app-shell">
        <p role="status">The database is waking up. This can take a few seconds...</p>
      </div>
    )
  }
  if (phase.kind === 'error') {
    return (
      <div className="app-shell">
        <p role="alert">{phase.message}</p>
        <button
          className="ghost"
          type="button"
          onClick={() => {
            setPhase({ kind: 'loading' })
            setAttempt((n) => n + 1)
          }}
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <Planner
      initialState={phase.state}
      initialVersions={phase.versions}
      savedSelection={phase.savedSelection}
      notice={phase.notice}
      isAdmin={user?.isAdmin === true}
      onSessionExpired={handleSignOut}
      onSignOut={handleSignOut}
      userEmail={user?.email ?? null}
    />
  )
}

export default AuthenticatedApp
