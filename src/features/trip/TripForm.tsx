import { useEffect, useRef, useState, type FormEvent } from 'react'
import { GOOGLE_MAPS_API_KEY } from '../../config'
import { formatDateRange } from '../../utils/date'
import { createId } from '../../utils/id'
import {
  buildGoogleMapsDirectionsUrl,
  openInGoogleMaps,
  validateStopsForMaps,
} from '../../utils/googleMaps'
import { StopWeatherForecast } from '../weather/StopWeatherForecast'
import type { StopForecast } from '../weather/types'
import type { TripStop, TripStopSourceName } from './types'
import { CampsiteSearch } from './CampsiteSearch'
import type { MapBounds } from '../../utils/campsiteSearch'

type TripFormProps = {
  stops: TripStop[]
  onAddStop: (stop: TripStop) => void
  onRemoveStop: (stopId: string) => void
  mapsLoaded: boolean
  weatherByStopId?: Record<string, StopForecast>
  weatherErrors?: Record<string, string>
  selectedStopIds: Set<string>
  onToggleStopSelection: (stopId: string) => void
  onSelectAllStops: () => void
  onClearStopSelection: () => void
  mapBounds?: MapBounds
}

type SuggestionItem = {
  id: string
  mainText: string
  secondaryText: string
  prediction: unknown
}

type SourceProvider = {
  name: TripStopSourceName
  homepage: string
  domain: string
}

const SOURCE_PROVIDERS: SourceProvider[] = [
  {
    name: 'Harvest Hosts',
    homepage: 'https://www.harvesthosts.com',
    domain: 'harvesthosts.com',
  },
]

type SiteType = {
  value: string
  label: string
}

const ALL_SITE_TYPES: SiteType[] = [
  { value: 'Free Parking', label: 'Free Parking' },
  { value: 'Boondocking', label: 'Boondocking' },
  { value: 'Fresh Water Refill', label: 'Fresh Water Refill' },
  { value: 'Dump Station', label: 'Dump Station' },
  { value: 'RV Park', label: 'RV Park' },
  { value: 'Harvest Host', label: 'Harvest Host' },
  { value: 'Campground', label: 'Campground' },
  { value: 'BLM Land', label: 'BLM Land' },
  { value: 'National Forest', label: 'National Forest' },
  { value: 'State Park', label: 'State Park' },
  { value: 'National Park', label: 'National Park' },
  { value: 'Truck Stop', label: 'Truck Stop' },
  { value: 'Rest Area', label: 'Rest Area' },
  { value: 'Parking Lot', label: 'Parking Lot' },
  { value: 'RV Resort', label: 'RV Resort' },
  { value: 'Resort', label: 'Resort' },
  { value: 'Beach/Lakeside', label: 'Beach/Lakeside' },
  { value: 'Farm Stay', label: 'Farm Stay' },
  { value: 'Winery', label: 'Winery' },
  { value: 'Marina', label: 'Marina' },
  { value: 'Cabin Rental', label: 'Cabin Rental' },
  { value: 'Glamping', label: 'Glamping' },
  { value: 'Dude Ranch', label: 'Dude Ranch' },
  { value: 'Hotel/Motel', label: 'Hotel/Motel' },
  { value: 'Airbnb/VRBO', label: 'Airbnb/VRBO' },
  { value: 'Hostel', label: 'Hostel' },
  { value: 'Trailhead Parking', label: 'Trailhead Parking' },
  { value: 'Day Use Area', label: 'Day Use Area' },
  { value: 'Private Property', label: 'Private Property' },
  { value: 'Other', label: 'Other' },
]

const SITE_TYPES_BY_SOURCE: Record<TripStopSourceName, SiteType[]> = {
  'RV Life': [
    { value: 'RV Park', label: 'RV Park' },
    { value: 'Campground', label: 'Campground' },
    { value: 'RV Resort', label: 'RV Resort' },
    { value: 'State Park', label: 'State Park' },
    { value: 'National Park', label: 'National Park' },
    { value: 'Free Parking', label: 'Free Parking' },
    { value: 'Other', label: 'Other' },
  ],
  'Hipcamp': [
    { value: 'Campground', label: 'Campground' },
    { value: 'RV Park', label: 'RV Park' },
    { value: 'Glamping', label: 'Glamping' },
    { value: 'Cabin Rental', label: 'Cabin Rental' },
    { value: 'Farm Stay', label: 'Farm Stay' },
    { value: 'Beach/Lakeside', label: 'Beach/Lakeside' },
    { value: 'State Park', label: 'State Park' },
    { value: 'National Park', label: 'National Park' },
    { value: 'Private Property', label: 'Private Property' },
    { value: 'Other', label: 'Other' },
  ],
  'Campendium': [
    { value: 'RV Park', label: 'RV Park' },
    { value: 'Campground', label: 'Campground' },
    { value: 'Boondocking', label: 'Boondocking' },
    { value: 'BLM Land', label: 'BLM Land' },
    { value: 'National Forest', label: 'National Forest' },
    { value: 'State Park', label: 'State Park' },
    { value: 'National Park', label: 'National Park' },
    { value: 'RV Resort', label: 'RV Resort' },
    { value: 'Free Parking', label: 'Free Parking' },
    { value: 'Cabin Rental', label: 'Cabin Rental' },
    { value: 'Glamping', label: 'Glamping' },
    { value: 'Resort', label: 'Resort' },
    { value: 'Other', label: 'Other' },
  ],
  'Harvest Hosts': [
    { value: 'Farm Stay', label: 'Farm Stay' },
    { value: 'Winery', label: 'Winery' },
    { value: 'Dude Ranch', label: 'Dude Ranch' },
    { value: 'Other', label: 'Other' },
  ],
  'RV Parky': [
    { value: 'RV Park', label: 'RV Park' },
    { value: 'RV Resort', label: 'RV Resort' },
    { value: 'Truck Stop', label: 'Truck Stop' },
    { value: 'Rest Area', label: 'Rest Area' },
    { value: 'Parking Lot', label: 'Parking Lot' },
    { value: 'Hotel/Motel', label: 'Hotel/Motel' },
    { value: 'Marina', label: 'Marina' },
    { value: 'Free Parking', label: 'Free Parking' },
    { value: 'Other', label: 'Other' },
  ],
  'Other': ALL_SITE_TYPES,
}

export const TripForm = ({
  stops,
  onAddStop,
  onRemoveStop,
  mapsLoaded,
  weatherByStopId = {},
  weatherErrors = {},
  selectedStopIds,
  onToggleStopSelection,
  onSelectAllStops,
  onClearStopSelection,
  mapBounds,
}: TripFormProps) => {
  const [label, setLabel] = useState('')
  const [address, setAddress] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [isStartPoint, setIsStartPoint] = useState(false)
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [sourceName, setSourceName] = useState<TripStopSourceName | ''>('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceSiteType, setSourceSiteType] = useState('')
  const [sourceFees, setSourceFees] = useState('')
  const [sourceAmenities, setSourceAmenities] = useState('')
  const [validationStatus, setValidationStatus] = useState<
    'idle' | 'validating' | 'valid' | 'invalid'
  >('idle')
  const [validationMessage, setValidationMessage] = useState('')
  const [lastValidatedAddress, setLastValidatedAddress] = useState('')
  const [predictions, setPredictions] = useState<SuggestionItem[]>([])
  const [predictionStatus, setPredictionStatus] = useState<
    'idle' | 'loading' | 'empty' | 'blocked'
  >('idle')
  const [mapsMessage, setMapsMessage] = useState('')
  const [mapsError, setMapsError] = useState('')
  const addressInputRef = useRef<HTMLInputElement | null>(null)
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    if (!mapsLoaded || !window.google?.maps?.places) {
      return
    }

    sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken()
  }, [mapsLoaded])

  useEffect(() => {
    if (!mapsLoaded) {
      return
    }

    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current)
    }

    const trimmedAddress = address.trim()
    if (!trimmedAddress) {
      setPredictions([])
      setPredictionStatus('idle')
      return
    }

    if (trimmedAddress.length < 3) {
      setPredictions([])
      setPredictionStatus('idle')
      return
    }

    // Don't fetch suggestions if address is already validated and hasn't changed
    if (validationStatus === 'valid' && trimmedAddress === lastValidatedAddress) {
      setPredictions([])
      setPredictionStatus('idle')
      return
    }

    debounceRef.current = window.setTimeout(() => {
      const places = google.maps.places as unknown as {
        AutocompleteSuggestion?: {
          fetchAutocompleteSuggestions?: (options: unknown) => Promise<{
            suggestions?: Array<{ placePrediction?: unknown }>
          }>
        }
      }

      if (!places?.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
        setPredictionStatus('blocked')
        return
      }

      setPredictionStatus('loading')
      const sessionToken =
        sessionTokenRef.current ??
        new google.maps.places.AutocompleteSessionToken()
      sessionTokenRef.current = sessionToken

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

          setPredictions(items)
          setPredictionStatus(items.length === 0 ? 'empty' : 'idle')
        })
        .catch(() => {
          setPredictions([])
          setPredictionStatus('blocked')
        })
    }, 250)

    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current)
      }
    }
  }, [address, mapsLoaded, validationStatus, lastValidatedAddress])

  const selectPrediction = async (item: SuggestionItem) => {
    setAddress(item.mainText)
    setPredictions([])
    setValidationStatus('idle')
    setValidationMessage('')

    const prediction = item.prediction as
      | {
          toPlace?: () => google.maps.places.Place
        }
      | undefined

    if (!prediction?.toPlace) {
      setValidationStatus('invalid')
      setValidationMessage('Address details unavailable.')
      return
    }

    try {
      const place = prediction.toPlace()
      await place.fetchFields({ fields: ['formattedAddress', 'location'] })
      const formattedAddress = place.formattedAddress
      const placeLocation = place.location

      if (formattedAddress) {
        setAddress(formattedAddress)
        setLastValidatedAddress(formattedAddress)
      } else {
        setLastValidatedAddress(item.mainText)
      }

      if (placeLocation) {
        setLocation({
          lat: placeLocation.lat(),
          lng: placeLocation.lng(),
        })
        setValidationStatus('valid')
        setValidationMessage('Address selected.')
      } else {
        setValidationStatus('invalid')
        setValidationMessage('Address could not be located.')
      }

      sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken()
    } catch (placeError) {
      setValidationStatus('invalid')
      setValidationMessage('Address details unavailable.')
    }
  }

  const validateAddress = async (addressText: string) => {
    if (!addressText.trim()) {
      return false
    }

    if (validationStatus === 'valid' && addressText === lastValidatedAddress) {
      return true
    }

    if (!GOOGLE_MAPS_API_KEY) {
      setValidationStatus('invalid')
      setValidationMessage('Missing Google Maps API key.')
      return false
    }

    setValidationStatus('validating')
    setValidationMessage('Validating address...')

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
        setValidationStatus('invalid')
        setValidationMessage('Address validation failed. Try again.')
        return false
      }

      const data = await response.json()
      const geocode = data?.result?.geocode?.location
      const formattedAddress = data?.result?.address?.formattedAddress
      const isValid = Boolean(geocode?.latitude && geocode?.longitude)

      if (!isValid) {
        setValidationStatus('invalid')
        setValidationMessage('Address could not be validated.')
        return false
      }

      if (formattedAddress) {
        setAddress(formattedAddress)
        setLastValidatedAddress(formattedAddress)
      } else {
        setLastValidatedAddress(addressText)
      }

      setLocation({ lat: geocode.latitude, lng: geocode.longitude })
      setValidationStatus('valid')
      setValidationMessage('Address confirmed.')
      return true
    } catch (validationError) {
      setValidationStatus('invalid')
      setValidationMessage('Address validation failed. Try again.')
      return false
    }
  }

  const handleOpenAllInMaps = () => {
    setMapsError('')
    setMapsMessage('')

    const validation = validateStopsForMaps(stops)
    if (!validation.valid) {
      setMapsError(validation.error || 'Cannot open in Google Maps')
      return
    }

    try {
      const url = buildGoogleMapsDirectionsUrl(stops)
      openInGoogleMaps(url)
      setMapsMessage(
        `Opened route with ${validation.validStops.length} stop${validation.validStops.length === 1 ? '' : 's'} in Google Maps`
      )
    } catch (err) {
      setMapsError(err instanceof Error ? err.message : 'Failed to open Google Maps')
    }
  }

  const handleOpenSelectedInMaps = () => {
    setMapsError('')
    setMapsMessage('')

    const selectedStops = stops.filter((stop) => selectedStopIds.has(stop.id))

    if (selectedStops.length === 0) {
      setMapsError('Please select at least one stop')
      return
    }

    const validation = validateStopsForMaps(selectedStops)
    if (!validation.valid) {
      setMapsError(validation.error || 'Cannot open in Google Maps')
      return
    }

    try {
      const selectedIndices = stops
        .map((stop, index) => (selectedStopIds.has(stop.id) ? index : -1))
        .filter((index) => index !== -1)
      const url = buildGoogleMapsDirectionsUrl(stops, selectedIndices)
      openInGoogleMaps(url)
      setMapsMessage(
        `Opened route with ${validation.validStops.length} selected stop${validation.validStops.length === 1 ? '' : 's'} in Google Maps`
      )
    } catch (err) {
      setMapsError(err instanceof Error ? err.message : 'Failed to open Google Maps')
    }
  }

  const openCoverageMap = async (addressText: string) => {
    const trimmedAddress = addressText.trim()
    if (!trimmedAddress) {
      return
    }

    try {
      await navigator.clipboard.writeText(trimmedAddress)
    } catch (clipboardError) {
      // If clipboard access is denied, still open the map.
    }

    window.open(
      'https://www.t-mobile.com/coverage/coverage-map',
      '_blank',
      'noopener,noreferrer'
    )
  }

  const openSourceLink = (provider: SourceProvider) => {
    window.open(provider.homepage, '_blank', 'noopener,noreferrer')
    
    // Copy address to clipboard
    if (address.trim()) {
      navigator.clipboard.writeText(address.trim()).catch(() => {
        // Silent fail if clipboard access is denied
      })
    }
    
    setSourceName(provider.name)
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')

    if (!address.trim()) {
      setError('Add an address for this stop.')
      return
    }

    if (!isStartPoint && !label.trim()) {
      setError('Add a title for each stop.')
      return
    }

    if (!isStartPoint && (!startDate || !endDate)) {
      setError('Add arrival and departure dates for each stop.')
      return
    }

    if (isStartPoint && !endDate) {
      setError('Add a departure date for the starting point.')
      return
    }

    if (startDate && endDate && startDate > endDate) {
      setError('Arrival date must be on or before the departure date.')
      return
    }

    const isValidated = await validateAddress(address)
    if (!isValidated) {
      setError('Please choose a validated address before adding this stop.')
      return
    }

    const resolvedLabel = label.trim() || 'Starting point'
    const resolvedStartDate = isStartPoint ? endDate : startDate
    const resolvedNote = note.trim().slice(0, 500)
    const trimmedSourceUrl = sourceUrl.trim()
    const trimmedSiteType = sourceSiteType.trim()
    const trimmedFees = sourceFees.trim()
    const trimmedAmenities = sourceAmenities.trim()
    const hasSourceDetails =
      Boolean(sourceName) ||
      Boolean(trimmedSourceUrl) ||
      Boolean(trimmedSiteType) ||
      Boolean(trimmedFees) ||
      Boolean(trimmedAmenities)
    const resolvedSourceName =
      sourceName || (hasSourceDetails ? 'Other' : '')

    const newStop: TripStop = {
      id: createId(),
      label: resolvedLabel,
      address: address.trim(),
      startDate: resolvedStartDate,
      endDate,
      note: resolvedNote ? resolvedNote : undefined,
      source: resolvedSourceName
        ? {
            name: resolvedSourceName as TripStopSourceName,
            url: trimmedSourceUrl || undefined,
            siteType: trimmedSiteType || undefined,
            fees: trimmedFees || undefined,
            amenities: trimmedAmenities || undefined,
          }
        : undefined,
      status: location ? 'ready' : 'idle',
      location: location ?? undefined,
    }

    onAddStop(newStop)
    setLabel('')
    setAddress('')
    setStartDate('')
    setEndDate('')
    setNote('')
    setIsStartPoint(false)
    setLocation(null)
    setSourceName('')
    setSourceUrl('')
    setSourceSiteType('')
    setSourceFees('')
    setSourceAmenities('')
    setValidationStatus('idle')
    setValidationMessage('')
    setLastValidatedAddress('')
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

      <form className="trip-form" onSubmit={onSubmit}>
        <div className="form-grid">
          <label>
            Stop title
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={isStartPoint ? 'Starting point' : 'Grand Canyon Village'}
              disabled={isStartPoint}
            />
          </label>
          <label>
            Starting point
            <input
              type="checkbox"
              checked={isStartPoint}
              onChange={(event) => {
                const checked = event.target.checked
                setIsStartPoint(checked)
                if (checked && endDate) {
                  setStartDate(endDate)
                }
              }}
            />
          </label>
          <label>
            Address
            <div className="address-field">
              <input
                ref={addressInputRef}
                value={address}
                onChange={(event) => {
                  setAddress(event.target.value)
                  setLocation(null)
                  setValidationStatus('idle')
                  setValidationMessage('')
                  setLastValidatedAddress('')
                  setPredictionStatus('idle')
                }}
                onBlur={() => {
                  window.setTimeout(() => {
                    if (predictions.length === 0) {
                      void validateAddress(address)
                    }
                  }, 150)
                }}
                placeholder="Grand Canyon Village, AZ"
              />
              {predictions.length > 0 ? (
                <div className="address-suggestions" role="listbox">
                  {predictions.map((prediction) => (
                    <button
                      key={prediction.id}
                      className="address-suggestion"
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault()
                      }}
                      onClick={() => selectPrediction(prediction)}
                    >
                      <span className="suggestion-primary">{prediction.mainText}</span>
                      {prediction.secondaryText ? (
                        <span className="suggestion-secondary">
                          {prediction.secondaryText}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </label>
          <label>
            Arrival
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              disabled={isStartPoint}
            />
          </label>
          <label>
            {isStartPoint ? 'Departure (used for weather)' : 'Departure'}
            <input
              type="date"
              value={endDate}
              onChange={(event) => {
                const nextDate = event.target.value
                setEndDate(nextDate)
                if (isStartPoint) {
                  setStartDate(nextDate)
                }
              }}
            />
          </label>
          <label>
            <span className="label-row">
              Note (optional)
              <span className="note-count">{note.length}/500</span>
            </span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value.slice(0, 500))}
              maxLength={500}
              rows={3}
              placeholder="Add parking details, check-in info, or reminders."
            />
          </label>
          <CampsiteSearch address={address} mapBounds={mapBounds} location={location} />
          <div className="source-section">
            <div className="source-header">
              <div>
                <p className="source-title">Campground source</p>
                <p className="muted">
                  Open official sites, then paste key details for this stop.
                </p>
              </div>
              <div className="source-actions">
                {SOURCE_PROVIDERS.map((provider) => (
                  <button
                    key={provider.name}
                    className="ghost"
                    type="button"
                    onClick={() => openSourceLink(provider)}
                  >
                    Open {provider.name}
                  </button>
                ))}
              </div>
            </div>
            <label>
              Source name
              <select
                value={sourceName}
                onChange={(event) => {
                  const newSourceName = event.target.value as TripStopSourceName
                  setSourceName(newSourceName)
                  // Reset site type when changing source
                  setSourceSiteType('')
                }}
              >
                <option value="">None</option>
                <option value="RV Life">RV Life</option>
                <option value="Hipcamp">Hipcamp</option>
                <option value="Campendium">Campendium</option>
                <option value="Harvest Hosts">Harvest Hosts</option>
                <option value="RV Parky">RV Parky</option>
                <option value="Other">Other</option>
              </select>
            </label>
            <label>
              Listing URL
              <input
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://..."
              />
            </label>
            <label>
              Site type
              <select
                value={sourceSiteType}
                onChange={(event) => setSourceSiteType(event.target.value)}
              >
                <option value="">
                  {sourceName
                    ? 'Select a site type...'
                    : 'Select source first or choose type...'}
                </option>
                {sourceName && SITE_TYPES_BY_SOURCE[sourceName as TripStopSourceName]
                  ? SITE_TYPES_BY_SOURCE[sourceName as TripStopSourceName].map(
                      (type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ),
                    )
                  : !sourceName
                    ? ALL_SITE_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))
                    : null}
              </select>
            </label>
            <label>
              Fees / requirements
              <input
                value={sourceFees}
                onChange={(event) => setSourceFees(event.target.value)}
                placeholder="$35/night, membership required"
              />
            </label>
            <label>
              Amenities / notes
              <input
                value={sourceAmenities}
                onChange={(event) => setSourceAmenities(event.target.value)}
                placeholder="Water, 30A, pets allowed"
              />
            </label>
          </div>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        {!error && validationMessage ? (
          <p
            className={
              validationStatus === 'invalid' ? 'form-error' : 'muted'
            }
          >
            {validationMessage}
          </p>
        ) : null}
        {!error && predictionStatus === 'blocked' ? (
          <p className="form-error">
            Autocomplete is blocked. Check Places API, billing, and API key
            restrictions.
          </p>
        ) : null}
        {!error && predictionStatus === 'empty' ? (
          <p className="muted">No address suggestions yet.</p>
        ) : null}
        <button className="primary" type="submit">
          Add stop
        </button>
      </form>

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

      {mapsError && <div className="maps-error">{mapsError}</div>}
      {mapsMessage && <div className="maps-message">{mapsMessage}</div>}

      <div className="stop-list">
        {stops.length === 0 ? (
          <div className="empty-state">
            <p>No stops yet. Start by adding your first destination.</p>
          </div>
        ) : (
          stops.map((stop) => (
            <div key={stop.id} className="stop-item">
              <article className="stop-card">
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
                  {stop.note ? <p className="stop-note">{stop.note}</p> : null}
                  <p className={`status status-${stop.status ?? 'idle'}`}>
                    {stop.status === 'geocoding' && 'Locating address'}
                    {stop.status === 'ready' && 'Map ready'}
                    {stop.status === 'error' && 'Could not locate'}
                    {(!stop.status || stop.status === 'idle') && 'Waiting to map'}
                  </p>
                </div>
                <button
                  className="ghost stop-remove"
                  type="button"
                  aria-label="Remove stop"
                  onClick={() => onRemoveStop(stop.id)}
                >
                  x
                </button>
              </article>
              <StopWeatherForecast
                stop={stop}
                forecast={weatherByStopId[stop.id]}
                error={weatherErrors[stop.id]}
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
