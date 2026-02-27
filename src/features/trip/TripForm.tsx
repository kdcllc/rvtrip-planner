import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { GOOGLE_MAPS_API_KEY } from '../../config/env'
import { formatDateRange, formatTime } from '../../utils/date'
import { createId } from '../../utils/id'
import { formatDistance } from '../../utils/distance'
import {
  buildGoogleMapsDirectionsUrl,
  openInGoogleMaps,
  validateStopsForMaps,
} from '../../services/maps/googleMaps'
import { requiresCheckInOut } from '../../utils/siteType'
import { StopWeatherForecast } from '../weather/StopWeatherForecast'
import type { StopForecast } from '../../domain/weather/types'
import type { TripStop, TripStopSourceName } from '../../domain/trip/types'
import { StopDrawer } from './StopDrawer'
import {
  type StopFormValues,
  type StopFormValidationState,
  type SuggestionItem,
} from './StopFormFields'
import type { MapBounds } from '../../services/campsiteSearch'

const STARTING_POINT_LABEL = 'Starting point'

type TripFormProps = {
  stops: TripStop[]
  onAddStop: (stop: TripStop) => void
  onRemoveStop: (stopId: string) => void
  onUpdateStop: (stopId: string, updates: Partial<TripStop>) => void
  onReorderStop: (stopId: string, direction: 'up' | 'down') => void
  mapsLoaded: boolean
  weatherByStopId?: Record<string, StopForecast>
  weatherErrors?: Record<string, string>
  selectedStopIds: Set<string>
  onToggleStopSelection: (stopId: string) => void
  onSelectAllStops: () => void
  onClearStopSelection: () => void
  mapBounds?: MapBounds
  currentStopId?: string | null
}

type DrawerState = {
  isOpen: boolean
  mode: 'add' | 'edit'
  stopId?: string
}

export type TripFormRef = {
  openAddDrawer: () => void
}

export const TripForm = forwardRef<TripFormRef, TripFormProps>(function TripForm({
  stops,
  onAddStop,
  onRemoveStop,
  onUpdateStop,
  onReorderStop,
  mapsLoaded,
  weatherByStopId = {},
  weatherErrors = {},
  selectedStopIds,
  onToggleStopSelection,
  onSelectAllStops,
  onClearStopSelection,
  mapBounds,
  currentStopId,
}: TripFormProps, ref) {
  // Add form state (for inline form - now removed, kept for reference)
  // All form state is now managed by drawer component

  // Drawer state
  const [drawerState, setDrawerState] = useState<DrawerState>({
    isOpen: false,
    mode: 'add',
  })

  // Drawer form state
  const [drawerFormValues, setDrawerFormValues] = useState<Partial<StopFormValues>>({
    label: '',
    address: '',
    startDate: '',
    endDate: '',
    checkInTime: '',
    checkOutTime: '',
    note: '',
    manualAddress: false,
    sourceName: '',
    sourceUrl: '',
    sourceSiteType: '',
    sourceFees: '',
    sourceAmenities: '',
    location: null,
  })

  const [drawerValidationState, setDrawerValidationState] = useState<StopFormValidationState>({
    status: 'idle',
    message: '',
    lastValidatedAddress: '',
    predictionStatus: 'idle',
  })

  const [drawerPredictions, setDrawerPredictions] = useState<SuggestionItem[]>([])
  const [drawerError, setDrawerError] = useState('')
  const drawerSessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null)
  const drawerDebounceRef = useRef<number | null>(null)

  // Initialize session tokens
  useEffect(() => {
    if (!mapsLoaded || !window.google?.maps?.places) {
      return
    }

    drawerSessionTokenRef.current = new google.maps.places.AutocompleteSessionToken()
  }, [mapsLoaded, drawerState.isOpen])

  // Drawer autocomplete effect
  useEffect(() => {
    if (!mapsLoaded || !drawerState.isOpen) {
      return
    }

    // Skip autocomplete if manual address mode is enabled
    if (drawerFormValues.manualAddress) {
      return
    }

    if (drawerDebounceRef.current) {
      window.clearTimeout(drawerDebounceRef.current)
    }

    const trimmedAddress = (drawerFormValues.address || '').trim()
    if (!trimmedAddress || trimmedAddress.length < 3) {
      return
    }

    if (
      drawerValidationState.status === 'valid' &&
      trimmedAddress === drawerValidationState.lastValidatedAddress
    ) {
      return
    }

    drawerDebounceRef.current = window.setTimeout(() => {
      const places = google.maps.places as unknown as {
        AutocompleteSuggestion?: {
          fetchAutocompleteSuggestions?: (options: unknown) => Promise<{
            suggestions?: Array<{ placePrediction?: unknown }>
          }>
        }
      }

      if (!places?.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
        setDrawerValidationState((prev) => ({
          ...prev,
          predictionStatus: 'blocked',
        }))
        return
      }

      setDrawerValidationState((prev) => ({
        ...prev,
        predictionStatus: 'loading',
      }))

      const sessionToken =
        drawerSessionTokenRef.current ??
        new google.maps.places.AutocompleteSessionToken()
      drawerSessionTokenRef.current = sessionToken

      places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: trimmedAddress,
        sessionToken,
        includedPrimaryTypes: ['geocode'],
      })
        .then((response) => {
          const suggestions = response?.suggestions ?? []
          const items: SuggestionItem[] = suggestions
            .map((suggestion) => {
              const prediction = suggestion.placePrediction as
                | {
                    text?: { text?: string }
                    structuredFormat?: {
                      mainText?: { text?: string }
                      secondaryText?: { text?: string }
                    }
                  }
                | undefined

              if (!prediction) {
                return null
              }

              const mainText =
                prediction.structuredFormat?.mainText?.text ??
                prediction.text?.text ??
                ''
              const secondaryText =
                prediction.structuredFormat?.secondaryText?.text ?? ''

              if (!mainText) {
                return null
              }

              return {
                id: `${mainText}-${secondaryText}`,
                mainText,
                secondaryText,
                prediction: suggestion.placePrediction,
              }
            })
            .filter((item): item is SuggestionItem => item !== null)

          setDrawerPredictions(items)
          setDrawerValidationState((prev) => ({
            ...prev,
            predictionStatus: items.length === 0 ? 'empty' : 'idle',
          }))
        })
        .catch(() => {
          setDrawerPredictions([])
          setDrawerValidationState((prev) => ({
            ...prev,
            predictionStatus: 'blocked',
          }))
        })
    }, 250)

    return () => {
      if (drawerDebounceRef.current) {
        window.clearTimeout(drawerDebounceRef.current)
      }
    }
  }, [drawerFormValues.address, drawerFormValues.manualAddress, mapsLoaded, drawerState.isOpen, drawerValidationState.status, drawerValidationState.lastValidatedAddress])

  // Drawer prediction selection
  const selectDrawerPrediction = async (item: SuggestionItem) => {
    setDrawerFormValues((prev) => ({
      ...prev,
      address: item.mainText,
      location: null,
    }))
    setDrawerPredictions([])
    // Mark as valid immediately to prevent autocomplete effect from re-fetching
    setDrawerValidationState((prev) => ({
      ...prev,
      status: 'valid',
      message: 'Loading address details...',
      lastValidatedAddress: item.mainText,
    }))

    const prediction = item.prediction as
      | {
          toPlace?: () => google.maps.places.Place
        }
      | undefined

    if (!prediction?.toPlace) {
      setDrawerValidationState((prev) => ({
        ...prev,
        status: 'invalid',
        message: 'Address details unavailable.',
      }))
      return
    }

    try {
      const place = prediction.toPlace()
      await place.fetchFields({ fields: ['formattedAddress', 'location'] })
      const placeLocation = place.location

      // Keep the user's selected address (item.mainText) as-is
      // Don't override with Google's formatted address which may abbreviate street names
      setDrawerValidationState((prev) => ({
        ...prev,
        lastValidatedAddress: item.mainText,
      }))

      if (placeLocation) {
        setDrawerFormValues((prev) => ({
          ...prev,
          location: {
            lat: placeLocation.lat(),
            lng: placeLocation.lng(),
          },
        }))
        setDrawerValidationState((prev) => ({
          ...prev,
          status: 'valid',
          message: 'Address selected.',
        }))
      } else {
        setDrawerValidationState((prev) => ({
          ...prev,
          status: 'invalid',
          message: 'Address could not be located.',
        }))
      }

      drawerSessionTokenRef.current = new google.maps.places.AutocompleteSessionToken()
    } catch {
      setDrawerValidationState((prev) => ({
        ...prev,
        status: 'invalid',
        message: 'Address details unavailable.',
      }))
    }
  }

  // Address validation for drawer
  const validateAddress = async (addressText: string): Promise<boolean> => {
    if (!addressText.trim()) {
      return false
    }

    if (
      drawerValidationState.status === 'valid' &&
      addressText === drawerValidationState.lastValidatedAddress
    ) {
      return true
    }

    if (!GOOGLE_MAPS_API_KEY) {
      setDrawerValidationState((prev) => ({
        ...prev,
        status: 'invalid',
        message: 'Missing Google Maps API key.',
      }))
      return false
    }

    setDrawerValidationState((prev) => ({
      ...prev,
      status: 'validating',
      message: 'Validating address...',
    }))

    try {
      const response = await fetch(
        `https://addressvalidation.googleapis.com/v1:validateAddress?key=${GOOGLE_MAPS_API_KEY}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            address: {
              addressLines: [addressText],
            },
          }),
        },
      )

      if (!response.ok) {
        setDrawerValidationState((prev) => ({
          ...prev,
          status: 'invalid',
          message: 'Address validation failed. Try again.',
        }))
        return false
      }

      const data = await response.json()
      const geocode = data?.result?.geocode?.location
      const formattedAddress = data?.result?.address?.formattedAddress
      const isValid = Boolean(geocode?.latitude && geocode?.longitude)

      if (!isValid) {
        setDrawerValidationState((prev) => ({
          ...prev,
          status: 'invalid',
          message: 'Address could not be validated.',
        }))
        return false
      }

      setDrawerFormValues((prev) => ({
        ...prev,
        address: formattedAddress || addressText,
        location: { lat: geocode.latitude, lng: geocode.longitude },
      }))
      setDrawerValidationState((prev) => ({
        ...prev,
        status: 'valid',
        message: 'Address confirmed.',
        lastValidatedAddress: formattedAddress || addressText,
      }))
      setDrawerPredictions([])

      return true
    } catch {
      setDrawerValidationState((prev) => ({
        ...prev,
        status: 'invalid',
        message: 'Address validation failed. Try again.',
      }))
      return false
    }
  }

  const handleOpenAllInMaps = () => {
    const validation = validateStopsForMaps(stops)
    if (!validation.valid) {
      console.warn('Cannot open in Google Maps:', validation.error)
      return
    }

    try {
      const url = buildGoogleMapsDirectionsUrl(stops)
      openInGoogleMaps(url)
    } catch (err) {
      console.error('Failed to open Google Maps:', err)
    }
  }

  const handleOpenSelectedInMaps = () => {
    const selectedStops = stops.filter((stop) => selectedStopIds.has(stop.id))

    if (selectedStops.length === 0) {
      console.warn('Please select at least one stop')
      return
    }

    const validation = validateStopsForMaps(selectedStops)
    if (!validation.valid) {
      console.warn('Cannot open in Google Maps:', validation.error)
      return
    }

    try {
      const selectedIndices = stops
        .map((stop, index) => (selectedStopIds.has(stop.id) ? index : -1))
        .filter((index) => index !== -1)
      const url = buildGoogleMapsDirectionsUrl(stops, selectedIndices)
      openInGoogleMaps(url)
    } catch (err) {
      console.error('Failed to open Google Maps:', err)
    }
  }

  const openCoverageMap = async (addressText: string) => {
    const trimmedAddress = addressText.trim()
    if (!trimmedAddress) {
      return
    }

    try {
      await navigator.clipboard.writeText(trimmedAddress)
    } catch {
      // If clipboard access is denied, still open the map.
    }

    window.open(
      'https://www.t-mobile.com/coverage/coverage-map',
      '_blank',
      'noopener,noreferrer'
    )
  }

  // Drawer form field change handler
  const handleDrawerFieldChange = (field: keyof StopFormValues, value: string | boolean | { lat: number; lng: number } | null) => {
    setDrawerFormValues((prev) => {
      const updated = {
        ...prev,
        [field]: value,
      }

      // When arrival date is set, auto-set departure to next day if not already set
      if (field === 'startDate' && typeof value === 'string' && value && !prev.endDate) {
        const arrivalDate = new Date(value + 'T00:00:00')
        const nextDay = new Date(arrivalDate)
        nextDay.setDate(nextDay.getDate() + 1)
        updated.endDate = nextDay.toISOString().split('T')[0]
      }

      return updated
    })

    // Reset validation on field change  
    if (field === 'address') {
      setDrawerValidationState((prev) => ({
        ...prev,
        status: 'idle',
        message: '',
        lastValidatedAddress: '',
      }))
    }

    // Clear predictions when manual address mode is enabled
    if (field === 'manualAddress' && value === true) {
      setDrawerPredictions([])
    }
  }

  // Open drawer for adding a stop
  const openAddDrawer = () => {
    setDrawerFormValues({
      label: '',
      address: '',
      startDate: '',
      endDate: '',
      checkInTime: '',
      checkOutTime: '',
      note: '',
      sourceName: '',
      sourceUrl: '',
      sourceSiteType: '',
      sourceFees: '',
      sourceAmenities: '',
      location: null,
      reservationStatus: '',
      confirmationNumber: '',
      siteNumber: '',
      contactPhone: '',
      nightlyCost: '',
      reservationNote: '',
    })
    setDrawerValidationState({
      status: 'idle',
      message: '',
      lastValidatedAddress: '',
      predictionStatus: 'idle',
    })
    setDrawerPredictions([])
    setDrawerError('')
    setDrawerState({
      isOpen: true,
      mode: 'add',
    })
    drawerSessionTokenRef.current =
      mapsLoaded && window.google?.maps?.places
        ? new google.maps.places.AutocompleteSessionToken()
        : null
  }

  // Expose openAddDrawer via ref for external callers
  useImperativeHandle(ref, () => ({
    openAddDrawer,
  }))

  // Open drawer for editing a stop
  const openEditDrawer = (stop: TripStop) => {
    setDrawerFormValues({
      label: stop.label === STARTING_POINT_LABEL ? '' : stop.label,
      address: stop.address,
      startDate: stop.startDate,
      endDate: stop.endDate,
      checkInTime: stop.checkInTime || '',
      checkOutTime: stop.checkOutTime || '',
      note: stop.note || '',
      isStartPoint: stop.label === STARTING_POINT_LABEL,
      manualAddress: stop.manualEntry || false,
      sourceName: stop.source?.name || '',
      sourceUrl: stop.source?.url || '',
      sourceSiteType: stop.source?.siteType || '',
      sourceFees: stop.source?.fees || '',
      sourceAmenities: stop.source?.amenities || '',
      location: stop.location || null,
      reservationStatus: stop.reservationStatus || '',
      confirmationNumber: stop.confirmationNumber || '',
      siteNumber: stop.siteNumber || '',
      contactPhone: stop.contactPhone || '',
      nightlyCost: stop.nightlyCost ? String(stop.nightlyCost) : '',
      reservationNote: stop.reservationNote || '',
    })
    setDrawerValidationState({
      status: stop.location ? 'valid' : 'idle',
      message: '',
      lastValidatedAddress: stop.address,
      predictionStatus: 'idle',
    })
    setDrawerPredictions([])
    setDrawerError('')
    setDrawerState({
      isOpen: true,
      mode: 'edit',
      stopId: stop.id,
    })
    drawerSessionTokenRef.current =
      mapsLoaded && window.google?.maps?.places
        ? new google.maps.places.AutocompleteSessionToken()
        : null
  }

  // Close drawer
  const closeDrawer = () => {
    setDrawerState({ isOpen: false, mode: 'add' })
    setDrawerFormValues({
      label: '',
      address: '',
      startDate: '',
      endDate: '',
      checkInTime: '',
      checkOutTime: '',
      note: '',
      manualAddress: false,
      sourceName: '',
      sourceUrl: '',
      sourceSiteType: '',
      sourceFees: '',
      sourceAmenities: '',
      location: null,
      reservationStatus: '',
      confirmationNumber: '',
      siteNumber: '',
      contactPhone: '',
      nightlyCost: '',
      reservationNote: '',
    })
    setDrawerValidationState({
      status: 'idle',
      message: '',
      lastValidatedAddress: '',
      predictionStatus: 'idle',
    })
    setDrawerPredictions([])
    setDrawerError('')
  }

  // Save drawer changes (for both add and edit modes)
  const saveDrawerChanges = async () => {
    setDrawerError('')

    const isStartingPoint = drawerFormValues.isStartPoint === true

    if (!(drawerFormValues.address || '').trim()) {
      setDrawerError('Add an address for this stop.')
      return
    }

    if (!isStartingPoint && !(drawerFormValues.label || '').trim()) {
      setDrawerError('Add a title for each stop.')
      return
    }

    if (!isStartingPoint && (!drawerFormValues.startDate || !drawerFormValues.endDate)) {
      setDrawerError('Add arrival and departure dates for each stop.')
      return
    }

    if (isStartingPoint && !drawerFormValues.endDate) {
      setDrawerError('Add a departure date for the starting point.')
      return
    }

    if (
      drawerFormValues.startDate &&
      drawerFormValues.endDate &&
      drawerFormValues.startDate > drawerFormValues.endDate
    ) {
      setDrawerError('Arrival date must be on or before the departure date.')
      return
    }

    // Validate check-out time is after check-in time on the same day
    if (
      drawerFormValues.checkInTime &&
      drawerFormValues.checkOutTime &&
      drawerFormValues.startDate === drawerFormValues.endDate &&
      requiresCheckInOut(drawerFormValues.sourceSiteType)
    ) {
      if (drawerFormValues.checkOutTime <= drawerFormValues.checkInTime) {
        setDrawerError('Check-out time must be after check-in time.')
        return
      }
    }

    // Skip validation if manual address mode is enabled
    if (!drawerFormValues.manualAddress) {
      const isValidated = await validateAddress(drawerFormValues.address || '')
      if (!isValidated) {
        setDrawerError('Please choose a validated address before saving.')
        return
      }
    } else {
      // For manual addresses, attempt best-effort geocoding in background
      // but don't block saving if it fails
      validateAddress(drawerFormValues.address || '').catch(() => {
        // Silently fail - manual entry allows bypassing validation
      })
    }

    const resolvedLabel = isStartingPoint
      ? STARTING_POINT_LABEL
      : (drawerFormValues.label || '').trim()
    const resolvedStartDate = isStartingPoint
      ? drawerFormValues.endDate || ''
      : drawerFormValues.startDate || ''
    const resolvedNote = (drawerFormValues.note || '').trim().slice(0, 500)
    const trimmedSourceUrl = (drawerFormValues.sourceUrl || '').trim()
    const trimmedSiteType = (drawerFormValues.sourceSiteType || '').trim()
    const trimmedFees = (drawerFormValues.sourceFees || '').trim()
    const trimmedAmenities = (drawerFormValues.sourceAmenities || '').trim()
    const trimmedCheckInTime = (drawerFormValues.checkInTime || '').trim()
    const trimmedCheckOutTime = (drawerFormValues.checkOutTime || '').trim()
    const hasSourceDetails =
      Boolean(drawerFormValues.sourceName) ||
      Boolean(trimmedSourceUrl) ||
      Boolean(trimmedSiteType) ||
      Boolean(trimmedFees) ||
      Boolean(trimmedAmenities)
    const resolvedSourceName =
      drawerFormValues.sourceName || (hasSourceDetails ? 'Other' : '')

    if (drawerState.mode === 'edit' && drawerState.stopId) {
      // Update existing stop
      const updates: Partial<TripStop> = {
        label: resolvedLabel,
        address: (drawerFormValues.address || '').trim(),
        startDate: resolvedStartDate || '',
        endDate: drawerFormValues.endDate || '',
        checkInTime:
          trimmedCheckInTime && requiresCheckInOut(trimmedSiteType)
            ? trimmedCheckInTime
            : undefined,
        checkOutTime:
          trimmedCheckOutTime && requiresCheckInOut(trimmedSiteType)
            ? trimmedCheckOutTime
            : undefined,
        note: resolvedNote ? resolvedNote : undefined,
        manualEntry: drawerFormValues.manualAddress || undefined,
        source: resolvedSourceName
          ? {
              name: resolvedSourceName as TripStopSourceName,
              url: trimmedSourceUrl || undefined,
              siteType: trimmedSiteType || undefined,
              fees: trimmedFees || undefined,
              amenities: trimmedAmenities || undefined,
            }
          : undefined,
        location: drawerFormValues.location ?? undefined,
        status: drawerFormValues.location ? 'ready' : 'idle',
        reservationStatus: (drawerFormValues.reservationStatus as 'reserved' | 'unreserved' | '') || undefined,
        confirmationNumber: (drawerFormValues.confirmationNumber || '').trim() || undefined,
        siteNumber: (drawerFormValues.siteNumber || '').trim() || undefined,
        contactPhone: (drawerFormValues.contactPhone || '').trim() || undefined,
        nightlyCost: drawerFormValues.nightlyCost ? parseFloat(drawerFormValues.nightlyCost) : undefined,
        reservationNote: (drawerFormValues.reservationNote || '').trim() || undefined,
      }
      onUpdateStop(drawerState.stopId, updates)
    } else {
      // Add new stop
      const newStop: TripStop = {
        id: createId(),
        label: resolvedLabel,
        address: (drawerFormValues.address || '').trim(),
        startDate: resolvedStartDate || '',
        endDate: drawerFormValues.endDate || '',
        checkInTime:
          trimmedCheckInTime && requiresCheckInOut(trimmedSiteType)
            ? trimmedCheckInTime
            : undefined,
        checkOutTime:
          trimmedCheckOutTime && requiresCheckInOut(trimmedSiteType)
            ? trimmedCheckOutTime
            : undefined,
        note: resolvedNote ? resolvedNote : undefined,
        manualEntry: drawerFormValues.manualAddress || undefined,
        source: resolvedSourceName
          ? {
              name: resolvedSourceName as TripStopSourceName,
              url: trimmedSourceUrl || undefined,
              siteType: trimmedSiteType || undefined,
              fees: trimmedFees || undefined,
              amenities: trimmedAmenities || undefined,
            }
          : undefined,
        status: drawerFormValues.location ? 'ready' : 'idle',
        location: drawerFormValues.location ?? undefined,
        reservationStatus: (drawerFormValues.reservationStatus as 'reserved' | 'unreserved' | '') || undefined,
        confirmationNumber: (drawerFormValues.confirmationNumber || '').trim() || undefined,
        siteNumber: (drawerFormValues.siteNumber || '').trim() || undefined,
        contactPhone: (drawerFormValues.contactPhone || '').trim() || undefined,
        nightlyCost: drawerFormValues.nightlyCost ? parseFloat(drawerFormValues.nightlyCost) : undefined,
        reservationNote: (drawerFormValues.reservationNote || '').trim() || undefined,
      }
      onAddStop(newStop)
    }

    closeDrawer()
  }

  // Delete stop (called from drawer)
  const handleDrawerDelete = () => {
    if (drawerState.stopId) {
      onRemoveStop(drawerState.stopId)
      closeDrawer()
    }
  }

  return (
    <div className="form-wrap">
      <div className="panel-header">
        <div>
          <h2>Trip stops</h2>
          <p>List each stop with dates and an address.</p>
        </div>
        <span className="chip">{stops.length} planned</span>
      </div>

      <button 
        className="primary" 
        type="button" 
        onClick={openAddDrawer}
        style={{ width: '100%' }}
      >
        Add stop
      </button>

      {stops.length > 0 && (
        <div className="maps-control-bar">
          <div className="maps-controls-left">
            <button
              className="ghost small"
              type="button"
              onClick={onSelectAllStops}
              disabled={selectedStopIds.size === stops.length}
            >
              Select all
            </button>
            <button
              className="ghost small"
              type="button"
              onClick={onClearStopSelection}
              disabled={selectedStopIds.size === 0}
            >
              Deselect all
            </button>
            <span className="selection-count">
              {selectedStopIds.size > 0
                ? `${selectedStopIds.size} of ${stops.length} selected`
                : `${stops.length} stop${stops.length === 1 ? '' : 's'}`}
            </span>
          </div>
          <div className="maps-controls-right">
            <button
              className="ghost small"
              type="button"
              onClick={handleOpenAllInMaps}
              title="Open all stops in Google Maps"
            >
              📍 Open All in Maps
            </button>
            <button
              className="ghost small"
              type="button"
              onClick={handleOpenSelectedInMaps}
              disabled={selectedStopIds.size === 0}
              title="Open selected stops in Google Maps"
            >
              📍 Open Selected in Maps
            </button>
          </div>
        </div>
      )}

      <div className="stop-list">
        {stops.length === 0 ? (
          <div className="empty-state">
            <p>No stops yet. Start by adding your first destination.</p>
          </div>
        ) : (
          stops.map((stop, index) => {
            const isStartingPoint = stop.label === STARTING_POINT_LABEL
            const isLast = index === stops.length - 1
            const canMoveUp =
              index > 0 &&
              (stops[index - 1].label === STARTING_POINT_LABEL) === isStartingPoint
            const canMoveDown =
              !isLast &&
              (stops[index + 1].label === STARTING_POINT_LABEL) === isStartingPoint

            return (
              <div key={stop.id} className="stop-item" data-stop-id={stop.id}>
                <article className={`stop-card ${currentStopId === stop.id ? 'stop-card--hovered' : ''}`}>
                  <div className="stop-card-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedStopIds.has(stop.id)}
                      onChange={() => onToggleStopSelection(stop.id)}
                      aria-label={`Select ${stop.label}`}
                    />
                  </div>

                  <div>
                    <h3>{stop.label}</h3>
                    <p className="muted">{stop.address}</p>
                    <p className="dates">{formatDateRange(stop.startDate, stop.endDate)}</p>
                    {(stop.checkInTime || stop.checkOutTime) && (
                      <p className="times">
                        {stop.checkInTime && `Check-in: ${formatTime(stop.checkInTime)}`}
                        {stop.checkInTime && stop.checkOutTime && ' • '}
                        {stop.checkOutTime && `Check-out: ${formatTime(stop.checkOutTime)}`}
                      </p>
                    )}
                    {(stop.distanceFromPreviousMeters || stop.estimatedFuelCost) && (
                      <div className="stop-travel-info">
                        {stop.distanceFromPreviousMeters && (
                          <p className="travel-detail">
                            <strong>Distance:</strong> {formatDistance(stop.distanceFromPreviousMeters)}
                          </p>
                        )}
                        {stop.estimatedFuelCost !== undefined && stop.estimatedFuelCost > 0 && (
                          <p className="travel-detail">
                            <strong>Est. Fuel Cost:</strong> ${stop.estimatedFuelCost.toFixed(2)}
                          </p>
                        )}
                      </div>
                    )}
                    {stop.address ? (
                      <button
                        className="coverage-link"
                        type="button"
                        onClick={() => void openCoverageMap(stop.address)}
                      >
                        Check T-Mobile coverage
                      </button>
                    ) : null}
                    {stop.source ? (
                      <div className="stop-source">
                        <span className="source-badge">{stop.source.name}</span>
                        {stop.source.url ? (
                          <a
                            className="source-link"
                            href={stop.source.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View listing
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                    {stop.source?.siteType ? (
                      <p className="source-detail">Type: {stop.source.siteType}</p>
                    ) : null}
                    {stop.source?.fees ? (
                      <p className="source-detail">Fees: {stop.source.fees}</p>
                    ) : null}
                    {stop.source?.amenities ? (
                      <p className="source-detail">
                        Amenities: {stop.source.amenities}
                      </p>
                    ) : null}
                    {stop.manualEntry ? (
                      <div className="stop-source">
                        <span className="source-badge manual-badge">Manual</span>
                      </div>
                    ) : null}
                    {stop.note ? <p className="stop-note">{stop.note}</p> : null}
                    <p className={`status status-${stop.status ?? 'idle'}`}>
                      {stop.status === 'geocoding' && 'Locating address'}
                      {stop.status === 'ready' && 'Map ready'}
                      {stop.status === 'error' && 'Could not locate'}
                      {(!stop.status || stop.status === 'idle') && 'Waiting to map'}
                    </p>
                  </div>

                  <div className="stop-actions">
                    <button
                      className="ghost stop-edit-button"
                      type="button"
                      aria-label="Edit stop"
                      onClick={() => openEditDrawer(stop)}
                    >
                      Edit
                    </button>
                    <div className="stop-reorder-controls">
                      <button
                        className="ghost stop-reorder-button"
                        type="button"
                        aria-label="Move stop up"
                        onClick={() => onReorderStop(stop.id, 'up')}
                        disabled={!canMoveUp}
                        title={canMoveUp ? 'Move up' : 'Cannot move up'}
                      >
                        ↑
                      </button>
                      <button
                        className="ghost stop-reorder-button"
                        type="button"
                        aria-label="Move stop down"
                        onClick={() => onReorderStop(stop.id, 'down')}
                        disabled={!canMoveDown}
                        title={canMoveDown ? 'Move down' : 'Cannot move down'}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                </article>
                <StopWeatherForecast
                  stop={stop}
                  forecast={weatherByStopId[stop.id]}
                  error={weatherErrors[stop.id]}
                />
              </div>
            )
          })
        )}
      </div>

      {/* Drawer modal for add/edit */}
      <StopDrawer
        isOpen={drawerState.isOpen}
        stop={drawerState.stopId ? stops.find((s) => s.id === drawerState.stopId) ?? null : null}
        mode={drawerState.mode}
        mapsLoaded={mapsLoaded}
        predictions={drawerPredictions}
        validationState={drawerValidationState}
        error={drawerError}
        formValues={drawerFormValues}
        mapBounds={mapBounds}
        onFieldChange={handleDrawerFieldChange}
        onSelectPrediction={selectDrawerPrediction}
        onSave={saveDrawerChanges}
        onCancel={closeDrawer}
        onDelete={drawerState.mode === 'edit' ? handleDrawerDelete : undefined}
      />
    </div>
  )
})
