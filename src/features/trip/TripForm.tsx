import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { formatDateRangeWithDays, formatTime } from '../../utils/date'
import { createId } from '../../utils/id'
import { formatDistance } from '../../utils/distance'
import { requiresCheckInOut } from '../../utils/siteType'
import { StopWeatherForecast } from '../weather/StopWeatherForecast'
import type { StopForecast } from '../../domain/weather/types'
import type { TripStop, TripStopSourceName } from '../../domain/trip/types'
import {
  STOP_NOTE_MAX_LENGTH,
  deriveStopLabel,
  hasStopDates,
} from '../../domain/trip/stopFields'
import { StopDrawer } from './StopDrawer'
import {
  type StopFormErrorField,
  type StopFormValues,
  type StopFormValidationState,
  type SuggestionItem,
} from './StopFormFields'
import type { MapBounds } from '../../services/campsiteSearch'
import { fetchAutocompleteSuggestions } from '../../services/geocoding/autocompleteService'
import { geocodeAddress } from '../../services/geocoding/geocodingService'
import { buildTruckMapPlaceUrl } from '../../utils/truckMapUrl'
import { TripTimeline } from './TripTimeline'
import { scrollCarouselToStop } from './carouselScroll'

const STARTING_POINT_LABEL = 'Starting point'

type TripFormProps = {
  stops: TripStop[]
  onAddStop: (stop: TripStop) => void
  onRemoveStop: (stopId: string) => void
  onUpdateStop: (stopId: string, updates: Partial<TripStop>) => void
  onReorderStop: (stopId: string, direction: 'up' | 'down') => void
  weatherByStopId?: Record<string, StopForecast>
  weatherErrors?: Record<string, string>
  selectedStopIds: Set<string>
  onToggleStopSelection: (stopId: string) => void
  onSelectAllStops: () => void
  onClearStopSelection: () => void
  mapBounds?: MapBounds
  currentStopId?: string | null
  autoFocusStopId?: string | null
  autoFocusKey?: string
  onCurrentStopChange?: (stopId: string | null) => void
  onSelectStop?: (stopId: string) => void
  onPreviewStop?: (stopId: string | null) => void
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
  weatherByStopId = {},
  weatherErrors = {},
  selectedStopIds,
  onToggleStopSelection,
  onSelectAllStops,
  onClearStopSelection,
  mapBounds,
  currentStopId,
  autoFocusStopId,
  autoFocusKey,
  onCurrentStopChange,
  onSelectStop,
  onPreviewStop,
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
  const [drawerErrorField, setDrawerErrorField] = useState<StopFormErrorField | null>(null)
  const [drawerErrorKey, setDrawerErrorKey] = useState(0)
  // Last title filled from an address; only that value may be replaced automatically.
  const autoTitleRef = useRef('')
  const [isValidatingAddress, setIsValidatingAddress] = useState(false)
  const drawerDebounceRef = useRef<number | null>(null)
  const drawerValidationStateRef = useRef<StopFormValidationState>(drawerValidationState)
  const carouselRef = useRef<HTMLDivElement | null>(null)
  const programmaticScrollRef = useRef(false)
  const scrollDebounceRef = useRef<number | null>(null)
  const releaseProgrammaticScrollRef = useRef<(() => void) | null>(null)
  const programmaticScrollTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (programmaticScrollTimeoutRef.current !== null) {
        window.clearTimeout(programmaticScrollTimeoutRef.current)
        programmaticScrollTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    drawerValidationStateRef.current = drawerValidationState
  }, [drawerValidationState])

  useEffect(() => {
    if (!carouselRef.current || !autoFocusStopId) {
      return
    }

    const carousel = carouselRef.current
    const stopId = autoFocusStopId

    if (!carousel.querySelector(`.stop-item[data-stop-id="${stopId}"]`)) {
      return
    }

    window.requestAnimationFrame(() => {
      scrollCarouselToStop(carousel, stopId)
    })
  }, [autoFocusKey, autoFocusStopId])

  const scrollStopsCarousel = (direction: 'left' | 'right') => {
    const container = carouselRef.current
    if (!container) {
      return
    }

    const firstCard = container.querySelector<HTMLElement>('.stop-item')
    if (!firstCard) {
      return
    }

    // Scroll by one card width plus gap (12px) to show next card
    const cardWidth = firstCard.offsetWidth
    const gap = 12
    const scrollStep = cardWidth + gap
    const multiplier = direction === 'left' ? -1 : 1

    container.scrollBy({
      left: scrollStep * multiplier,
      behavior: 'smooth',
    })
  }

  // Track which stop is currently visible in the carousel and update timeline highlighting
  useEffect(() => {
    if (!carouselRef?.current || !onCurrentStopChange) return

    const carousel = carouselRef.current
    const handleStopChange = onCurrentStopChange // Capture in local variable

    const updateVisibleStop = () => {
      if (programmaticScrollRef.current) return
      const stopElements = carousel.querySelectorAll<HTMLElement>('.stop-item')
      if (stopElements.length === 0) return

      // Find the stop that's most centered in the viewport
      const carouselCenter = carousel.scrollLeft + carousel.clientWidth / 2
      
      // Use Array.from to avoid forEach type inference issues
      const stopArray = Array.from(stopElements)
      let closestStop: HTMLElement | null = null
      let closestDistance = Infinity

      for (const stopElement of stopArray) {
        const stopCenter = stopElement.offsetLeft + stopElement.offsetWidth / 2
        const distance = Math.abs(stopCenter - carouselCenter)
        if (distance < closestDistance) {
          closestDistance = distance
          closestStop = stopElement
        }
      }

      // Extract and use the stop ID if found
      if (closestStop) {
        const stopId = closestStop.getAttribute('data-stop-id')
        if (stopId) {
          handleStopChange(stopId)
        }
      }
    }

    // Update on scroll with debouncing for performance
    const clearScrollDebounce = () => {
      if (scrollDebounceRef.current !== null) {
        window.clearTimeout(scrollDebounceRef.current)
        scrollDebounceRef.current = null
      }
    }
    const handleScroll = () => {
      if (programmaticScrollRef.current) return
      clearScrollDebounce()
      scrollDebounceRef.current = window.setTimeout(updateVisibleStop, 50)
    }
    const release = () => {
      programmaticScrollRef.current = false
      if (programmaticScrollTimeoutRef.current !== null) {
        window.clearTimeout(programmaticScrollTimeoutRef.current)
        programmaticScrollTimeoutRef.current = null
      }
      clearScrollDebounce()
    }
    releaseProgrammaticScrollRef.current = release

    carousel.addEventListener('scroll', handleScroll)
    carousel.addEventListener('scrollend', release)
    // Initial update
    updateVisibleStop()

    return () => {
      carousel.removeEventListener('scroll', handleScroll)
      carousel.removeEventListener('scrollend', release)
      clearScrollDebounce()
      releaseProgrammaticScrollRef.current = null
    }
  }, [stops.length, onCurrentStopChange])

  // Drawer autocomplete effect
  useEffect(() => {
    if (!drawerState.isOpen) {
      return
    }

    // Skip autocomplete if manual address mode is enabled.
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

    drawerDebounceRef.current = window.setTimeout(async () => {
      const currentValidationState = drawerValidationStateRef.current
      if (
        currentValidationState.status === 'valid' &&
        trimmedAddress === currentValidationState.lastValidatedAddress
      ) {
        setDrawerPredictions([])
        setDrawerValidationState((prev) => ({
          ...prev,
          predictionStatus: 'idle',
        }))
        return
      }

      setDrawerValidationState((prev) => ({
        ...prev,
        predictionStatus: 'loading',
      }))

      try {
        const result = await fetchAutocompleteSuggestions(trimmedAddress)
        const suggestionItems: SuggestionItem[] = result.suggestions.map((suggestion) => ({
          id: suggestion.id,
          mainText: suggestion.mainText,
          secondaryText: suggestion.secondaryText,
          location: suggestion.location ?? undefined,
        }))

        setDrawerPredictions(suggestionItems)
        setDrawerValidationState((prev) => ({
          ...prev,
          predictionStatus: suggestionItems.length === 0 ? 'empty' : 'idle',
        }))
      } catch (error) {
        console.error('Autocomplete error:', error)
        setDrawerPredictions([])
        setDrawerValidationState((prev) => ({
          ...prev,
          predictionStatus: 'blocked',
        }))
      }
    }, 250)

    return () => {
      if (drawerDebounceRef.current) {
        window.clearTimeout(drawerDebounceRef.current)
      }
    }
  }, [drawerFormValues.address, drawerFormValues.manualAddress, drawerState.isOpen])

  const raiseDrawerError = (message: string, field: StopFormErrorField) => {
    setDrawerError(message)
    setDrawerErrorField(field)
    setDrawerErrorKey((key) => key + 1)
  }

  const clearDrawerError = () => {
    setDrawerError('')
    setDrawerErrorField(null)
  }

  // Drawer prediction selection
  const selectDrawerPrediction = async (item: SuggestionItem) => {
    // Combine mainText and secondaryText to form complete address
    const fullAddress = item.secondaryText 
      ? `${item.mainText}, ${item.secondaryText}`
      : item.mainText
    
    setDrawerFormValues((prev) => {
      const currentTitle = (prev.label || '').trim()
      const canAutoFill =
        !prev.isStartPoint &&
        (currentTitle === '' || currentTitle === autoTitleRef.current)
      const nextTitle = canAutoFill ? deriveStopLabel(fullAddress) : prev.label
      if (canAutoFill) {
        autoTitleRef.current = nextTitle || ''
      }
      return {
        ...prev,
        label: nextTitle,
        address: fullAddress,
        location: null,
      }
    })
    setDrawerPredictions([])
    // Mark as valid immediately to prevent autocomplete effect from re-fetching
    setDrawerValidationState((prev) => ({
      ...prev,
      status: 'valid',
      message: 'Loading address details...',
      lastValidatedAddress: fullAddress,
    }))

    try {
      // If the suggestion already has location data, use it directly
      if (item.location) {
        setDrawerFormValues((prev) => ({
          ...prev,
          location: item.location!,
        }))
        setDrawerValidationState((prev) => ({
          ...prev,
          status: 'valid',
          message: 'Address selected.',
          lastValidatedAddress: fullAddress,
        }))
        return
      }

      // Otherwise, geocode the selected address
      const result = await geocodeAddress(fullAddress)
      
      if (result?.location) {
        setDrawerFormValues((prev) => ({
          ...prev,
          location: result.location,
        }))
        setDrawerValidationState((prev) => ({
          ...prev,
          status: 'valid',
          message: 'Address selected.',
          lastValidatedAddress: fullAddress,
        }))
      } else {
        setDrawerValidationState((prev) => ({
          ...prev,
          status: 'invalid',
          message: 'Address could not be located.',
        }))
      }
    } catch (error) {
      console.error('Geocoding error:', error)
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

    setDrawerValidationState((prev) => ({
      ...prev,
      status: 'validating',
      message: 'Validating address...',
    }))

    try {
      const result = await geocodeAddress(addressText)

      if (!result?.location) {
        setDrawerValidationState((prev) => ({
          ...prev,
          status: 'invalid',
          message: 'Address could not be validated.',
        }))
        return false
      }

      setDrawerFormValues((prev) => ({
        ...prev,
        address: result.address,
        location: result.location,
      }))
      setDrawerValidationState((prev) => ({
        ...prev,
        status: 'valid',
        message: 'Address confirmed.',
        lastValidatedAddress: result.address,
      }))
      setDrawerPredictions([])

      return true
    } catch (error) {
      console.error('Address validation error:', error)
      setDrawerValidationState((prev) => ({
        ...prev,
        status: 'invalid',
        message: 'Address validation failed. Try again.',
      }))
      return false
    }
  }

  // Validate current address without saving - for user feedback
  const validateCurrentAddress = async () => {
    setIsValidatingAddress(true)
    try {
      const addressText = (drawerFormValues.address || '').trim()
      if (!addressText) {
        setDrawerValidationState((prev) => ({
          ...prev,
          status: 'invalid',
          message: 'Address is empty.',
        }))
        return
      }

      await validateAddress(addressText)
    } finally {
      setIsValidatingAddress(false)
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

  // Timeline stop click handler - scrolls carousel sideways only and selects the stop
  const handleTimelineStopClick = (stopId: string) => {
    if (carouselRef.current) {
      if (onCurrentStopChange) {
        programmaticScrollRef.current = true
        if (programmaticScrollTimeoutRef.current !== null) {
          window.clearTimeout(programmaticScrollTimeoutRef.current)
        }
        programmaticScrollTimeoutRef.current = window.setTimeout(() => {
          releaseProgrammaticScrollRef.current?.()
        }, 700)
      }
      scrollCarouselToStop(carouselRef.current, stopId)
    }
    onCurrentStopChange?.(stopId)
    onSelectStop?.(stopId)
  }

  // Timeline details handler - jumps the page to the stop's card
  const handleTimelineStopDetails = (stopId: string) => {
    const stopElement = carouselRef.current?.querySelector(
      `.stop-item[data-stop-id="${stopId}"]`
    )
    if (stopElement) {
      const reduceMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      stopElement.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'nearest',
        inline: 'center',
      })
    }
    onCurrentStopChange?.(stopId)
  }

  // Drawer form field change handler
  const handleDrawerFieldChange = (field: keyof StopFormValues, value: string | boolean | { lat: number; lng: number } | null) => {
    // Editing the field an error belongs to clears that error.
    const fieldErrorOwner: Partial<Record<keyof StopFormValues, StopFormErrorField>> = {
      address: 'address',
      startDate: 'dates',
      endDate: 'dates',
      checkInTime: 'checkOutTime',
      checkOutTime: 'checkOutTime',
    }
    if (drawerErrorField && fieldErrorOwner[field] === drawerErrorField) {
      clearDrawerError()
    }

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
      const nextAddress = typeof value === 'string' ? value.trim() : ''
      setDrawerValidationState((prev) => ({
        ...prev,
        status: 'idle',
        message: '',
        lastValidatedAddress: '',
        predictionStatus: nextAddress.length >= 3 ? prev.predictionStatus : 'idle',
      }))

      if (nextAddress.length < 3) {
        setDrawerPredictions([])
      }
    }

    // Clear predictions when manual address mode is toggled.
    if (field === 'manualAddress') {
      setDrawerPredictions([])
      setDrawerValidationState((prev) => ({
        ...prev,
        predictionStatus: 'idle',
      }))
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
      location: null,
      reservationStatus: '',
      confirmationNumber: '',
      siteNumber: '',
      contactPhone: '',
      nightlyCost: '',
      actualGasCost: '',
      actualFoodCost: '',
      actualMiscCost: '',
    })
    setDrawerValidationState({
      status: 'idle',
      message: '',
      lastValidatedAddress: '',
      predictionStatus: 'idle',
    })
    setDrawerPredictions([])
    clearDrawerError()
    autoTitleRef.current = ''
    setDrawerState({
      isOpen: true,
      mode: 'add',
    })
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
      location: stop.location || null,
      reservationStatus: stop.reservationStatus || '',
      confirmationNumber: stop.confirmationNumber || '',
      siteNumber: stop.siteNumber || '',
      contactPhone: stop.contactPhone || '',
      nightlyCost: stop.nightlyCost ? String(stop.nightlyCost) : '',
      actualGasCost: stop.actualGasCost ? String(stop.actualGasCost) : '',
      actualFoodCost: stop.actualFoodCost ? String(stop.actualFoodCost) : '',
      actualMiscCost: stop.actualMiscCost ? String(stop.actualMiscCost) : '',
    })
    setDrawerValidationState({
      status: stop.location ? 'valid' : 'idle',
      message: '',
      lastValidatedAddress: stop.address,
      predictionStatus: 'idle',
    })
    setDrawerPredictions([])
    clearDrawerError()
    autoTitleRef.current = ''
    setDrawerState({
      isOpen: true,
      mode: 'edit',
      stopId: stop.id,
    })
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
      location: null,
      reservationStatus: '',
      confirmationNumber: '',
      siteNumber: '',
      contactPhone: '',
      nightlyCost: '',
      actualGasCost: '',
      actualFoodCost: '',
      actualMiscCost: '',
    })
    setDrawerValidationState({
      status: 'idle',
      message: '',
      lastValidatedAddress: '',
      predictionStatus: 'idle',
    })
    setDrawerPredictions([])
    clearDrawerError()
    autoTitleRef.current = ''
  }

  // Save drawer changes (for both add and edit modes)
  const saveDrawerChanges = async () => {
    clearDrawerError()

    const isStartingPoint = drawerFormValues.isStartPoint === true

    if (!(drawerFormValues.address || '').trim()) {
      raiseDrawerError('Add an address for this stop.', 'address')
      return
    }

    if (
      drawerFormValues.startDate &&
      drawerFormValues.endDate &&
      drawerFormValues.startDate > drawerFormValues.endDate
    ) {
      raiseDrawerError('Arrival date must be on or before the departure date.', 'dates')
      return
    }

    // Validate check-out time is after check-in time on the same day
    if (
      drawerFormValues.checkInTime &&
      drawerFormValues.checkOutTime &&
      drawerFormValues.startDate &&
      drawerFormValues.startDate === drawerFormValues.endDate &&
      requiresCheckInOut(drawerFormValues.sourceSiteType)
    ) {
      if (drawerFormValues.checkOutTime <= drawerFormValues.checkInTime) {
        raiseDrawerError('Check-out time must be after check-in time.', 'checkOutTime')
        return
      }
    }

    // Resolve final location value (may be updated by manual geocoding)
    let finalLocation = drawerFormValues.location

    // Skip validation if manual address mode is enabled
    if (!drawerFormValues.manualAddress) {
      const isValidated = await validateAddress(drawerFormValues.address || '')
      if (!isValidated) {
        raiseDrawerError('Please choose a validated address before saving.', 'address')
        return
      }
    } else {
      // For manual addresses, attempt geocoding to populate coordinates for map display.
      // Don't block saving if geocoding fails, but ensure location is included if it succeeds.
      const addressToGeocode = (drawerFormValues.address || '').trim()
      if (addressToGeocode) {
        try {
          const result = await geocodeAddress(addressToGeocode)
          if (result?.location) {
            finalLocation = result.location
            // Also update state for consistency and future reference
            setDrawerFormValues((prev) => ({
              ...prev,
              address: result.address,
              location: result.location,
            }))
          } else {
            console.warn('[saveDrawerChanges] Geocoding returned no location:', result)
          }
        } catch (error) {
          // Manual entry allows saving even if geocoding fails
          console.error('[saveDrawerChanges] Manual address geocoding failed:', error)
        }
      } else {
        console.warn('[saveDrawerChanges] Manual address is empty after trim')
      }
    }

    const typedLabel = (drawerFormValues.label || '').trim()
    const resolvedLabel = isStartingPoint
      ? STARTING_POINT_LABEL
      : typedLabel === '' || typedLabel === autoTitleRef.current
        ? deriveStopLabel(drawerFormValues.address || '')
        : typedLabel
    const resolvedStartDate = isStartingPoint
      ? drawerFormValues.endDate || ''
      : drawerFormValues.startDate || ''
    const resolvedNote = (drawerFormValues.note || '').trim().slice(0, STOP_NOTE_MAX_LENGTH)
    const trimmedSourceUrl = (drawerFormValues.sourceUrl || '').trim()
    const trimmedSiteType = (drawerFormValues.sourceSiteType || '').trim()
    const trimmedCheckInTime = (drawerFormValues.checkInTime || '').trim()
    const trimmedCheckOutTime = (drawerFormValues.checkOutTime || '').trim()
    const hasSourceDetails =
      Boolean(drawerFormValues.sourceName) ||
      Boolean(trimmedSourceUrl) ||
      Boolean(trimmedSiteType)
    const resolvedSourceName =
      drawerFormValues.sourceName || (hasSourceDetails ? 'Other' : '')
    const parseOptionalNumber = (value?: string): number | undefined => {
      if (!value || !value.trim()) {
        return undefined
      }

      const parsed = Number.parseFloat(value)
      if (!Number.isFinite(parsed)) {
        return undefined
      }

      return parsed
    }

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
            }
          : undefined,
        location: finalLocation ?? undefined,
        status: finalLocation ? 'ready' : 'idle',
        reservationStatus: (drawerFormValues.reservationStatus as 'reserved' | 'unreserved' | '') || undefined,
        confirmationNumber: (drawerFormValues.confirmationNumber || '').trim() || undefined,
        siteNumber: (drawerFormValues.siteNumber || '').trim() || undefined,
        contactPhone: (drawerFormValues.contactPhone || '').trim() || undefined,
        nightlyCost: parseOptionalNumber(drawerFormValues.nightlyCost),
        actualGasCost: parseOptionalNumber(drawerFormValues.actualGasCost),
        actualFoodCost: parseOptionalNumber(drawerFormValues.actualFoodCost),
        actualMiscCost: parseOptionalNumber(drawerFormValues.actualMiscCost),
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
            }
          : undefined,
        status: finalLocation ? 'ready' : 'idle',
        location: finalLocation ?? undefined,
        reservationStatus: (drawerFormValues.reservationStatus as 'reserved' | 'unreserved' | '') || undefined,
        confirmationNumber: (drawerFormValues.confirmationNumber || '').trim() || undefined,
        siteNumber: (drawerFormValues.siteNumber || '').trim() || undefined,
        contactPhone: (drawerFormValues.contactPhone || '').trim() || undefined,
        nightlyCost: parseOptionalNumber(drawerFormValues.nightlyCost),
        actualGasCost: parseOptionalNumber(drawerFormValues.actualGasCost),
        actualFoodCost: parseOptionalNumber(drawerFormValues.actualFoodCost),
        actualMiscCost: parseOptionalNumber(drawerFormValues.actualMiscCost),
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

  const handleGenerateTruckMapUrl = () => {
    const generatedUrl = buildTruckMapPlaceUrl(drawerFormValues.address || '')

    if (!generatedUrl) {
      setDrawerValidationState((prev) => ({
        ...prev,
        status: 'invalid',
        message:
          'Add a full address (for example: City, State, USA) to generate a TruckMap URL.',
      }))
      return
    }

    clearDrawerError()
    setDrawerFormValues((prev) => ({
      ...prev,
      sourceUrl: generatedUrl,
    }))
    setDrawerValidationState((prev) => ({
      ...prev,
      status: 'valid',
      message: 'TruckMap URL generated from address.',
    }))
  }

  return (
    <div className="form-wrap">
      <div className="panel-header">
        <div>
          <h2>Trip stops</h2>
          <p>List each stop with dates and an address.</p>
        </div>
        <div className="stop-header-actions">
          <span className="chip">{stops.length} planned</span>
        </div>
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
        </div>
      )}

      {/* Timeline - shows visual overview of trip dates */}
      <TripTimeline
        stops={stops}
        onStopClick={handleTimelineStopClick}
        onStopDetails={handleTimelineStopDetails}
        onStopPreview={onPreviewStop}
        currentStopId={currentStopId ?? null}
        actions={
          stops.length > 0 ? (
            <div
              className="stop-carousel-controls"
              role="group"
              aria-label="Scroll trip stops"
            >
              <button
                className="ghost small"
                type="button"
                onClick={() => scrollStopsCarousel('left')}
                aria-label="Scroll stops left"
                title="Scroll stops left"
              >
                ←
              </button>
              <button
                className="ghost small"
                type="button"
                onClick={() => scrollStopsCarousel('right')}
                aria-label="Scroll stops right"
                title="Scroll stops right"
              >
                →
              </button>
            </div>
          ) : undefined
        }
      />

      <div
        ref={carouselRef}
        className={`stop-list ${stops.length === 0 ? 'stop-list--empty' : ''}`}
        role="region"
        aria-label="Trip stops carousel"
      >
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
            const truckMapUrl = buildTruckMapPlaceUrl(stop.address)
            const hasTruckMapSourceUrl =
              Boolean(stop.source?.url) && stop.source?.url === truckMapUrl

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
                    {stop.address ? (
                      <span className="stop-address">📍 {stop.address}</span>
                    ) : (
                      <p className="muted">No address</p>
                    )}
                    <p className="dates">{hasStopDates(stop)
                      ? formatDateRangeWithDays(stop.startDate, stop.endDate)
                      : stop.startDate || stop.endDate
                        ? formatDateRangeWithDays(
                            stop.startDate || stop.endDate,
                            stop.startDate || stop.endDate,
                          )
                        : 'Dates not set'}</p>
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
                    <div className="stop-action-buttons">
                      {stop.address ? (
                        <button
                          className="action-icon-button"
                          type="button"
                          onClick={() => void openCoverageMap(stop.address)}
                          title="Check T-Mobile coverage"
                        >
                          📶
                        </button>
                      ) : null}
                      {truckMapUrl && !hasTruckMapSourceUrl ? (
                        <a
                          className="action-icon-button"
                          href={truckMapUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="Open in TruckMap"
                        >
                          🚚
                        </a>
                      ) : null}
                    </div>
                    {(stop.source || stop.manualEntry) && (
                      <div className="source-info-group">
                        <div className="source-header">
                          {stop.source ? (
                            <span className="source-badge">{stop.source.name}</span>
                          ) : null}
                          {stop.manualEntry ? (
                            <span className="source-badge manual-badge">Manual</span>
                          ) : null}
                          {stop.source?.url ? (
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
                        {stop.source?.siteType ? (
                          <p className="source-detail">Type: {stop.source.siteType}</p>
                        ) : null}
                      </div>
                    )}
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
                        aria-label="Move stop left"
                        onClick={() => onReorderStop(stop.id, 'up')}
                        disabled={!canMoveUp}
                        title={canMoveUp ? 'Move left' : 'Cannot move left'}
                      >
                        &lt;
                      </button>
                      <button
                        className="ghost stop-reorder-button"
                        type="button"
                        aria-label="Move stop right"
                        onClick={() => onReorderStop(stop.id, 'down')}
                        disabled={!canMoveDown}
                        title={canMoveDown ? 'Move right' : 'Cannot move right'}
                      >
                        &gt;
                      </button>
                    </div>
                  </div>
                </article>
                {(weatherByStopId[stop.id] || weatherErrors[stop.id]) && (
                  <div className="stop-weather-container">
                    <StopWeatherForecast
                      stop={stop}
                      forecast={weatherByStopId[stop.id]}
                      error={weatherErrors[stop.id]}
                    />
                  </div>
                )}
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
        predictions={drawerPredictions}
        validationState={drawerValidationState}
        error={drawerError}
        errorField={drawerErrorField}
        errorKey={drawerErrorKey}
        formValues={drawerFormValues}
        mapBounds={mapBounds}
        isValidatingAddress={isValidatingAddress}
        onFieldChange={handleDrawerFieldChange}
        onSelectPrediction={selectDrawerPrediction}
        onGenerateSourceUrl={handleGenerateTruckMapUrl}
        onValidateCurrentAddress={validateCurrentAddress}
        onSave={saveDrawerChanges}
        onCancel={closeDrawer}
        onDelete={drawerState.mode === 'edit' ? handleDrawerDelete : undefined}
      />
    </div>
  )
})
