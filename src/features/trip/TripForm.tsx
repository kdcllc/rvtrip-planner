import { useEffect, useRef, useState, type FormEvent } from 'react'
import { GOOGLE_MAPS_API_KEY } from '../../config'
import { formatDateRange } from '../../utils/date'
import { createId } from '../../utils/id'
import type { TripStop } from './types'

type TripFormProps = {
  stops: TripStop[]
  onAddStop: (stop: TripStop) => void
  onRemoveStop: (stopId: string) => void
  mapsLoaded: boolean
}

type SuggestionItem = {
  id: string
  mainText: string
  secondaryText: string
  prediction: unknown
}

export const TripForm = ({
  stops,
  onAddStop,
  onRemoveStop,
  mapsLoaded,
}: TripFormProps) => {
  const [label, setLabel] = useState('')
  const [address, setAddress] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [error, setError] = useState('')
  const [isStartPoint, setIsStartPoint] = useState(false)
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [validationStatus, setValidationStatus] = useState<
    'idle' | 'validating' | 'valid' | 'invalid'
  >('idle')
  const [validationMessage, setValidationMessage] = useState('')
  const [lastValidatedAddress, setLastValidatedAddress] = useState('')
  const [predictions, setPredictions] = useState<SuggestionItem[]>([])
  const [predictionStatus, setPredictionStatus] = useState<
    'idle' | 'loading' | 'empty' | 'blocked'
  >('idle')
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
  }, [address, mapsLoaded])

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

    const newStop: TripStop = {
      id: createId(),
      label: resolvedLabel,
      address: address.trim(),
      startDate: resolvedStartDate,
      endDate,
      status: location ? 'ready' : 'idle',
      location: location ?? undefined,
    }

    onAddStop(newStop)
    setLabel('')
    setAddress('')
    setStartDate('')
    setEndDate('')
    setIsStartPoint(false)
    setLocation(null)
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

      <div className="stop-list">
        {stops.length === 0 ? (
          <div className="empty-state">
            <p>No stops yet. Start by adding your first destination.</p>
          </div>
        ) : (
          stops.map((stop) => (
            <article key={stop.id} className="stop-card">
              <div>
                <h3>{stop.label}</h3>
                <p className="muted">{stop.address}</p>
                <p className="dates">{formatDateRange(stop.startDate, stop.endDate)}</p>
                <p className={`status status-${stop.status ?? 'idle'}`}>
                  {stop.status === 'geocoding' && 'Locating address'}
                  {stop.status === 'ready' && 'Map ready'}
                  {stop.status === 'error' && 'Could not locate'}
                  {(!stop.status || stop.status === 'idle') && 'Waiting to map'}
                </p>
              </div>
              <button className="ghost" type="button" onClick={() => onRemoveStop(stop.id)}>
                Remove
              </button>
            </article>
          ))
        )}
      </div>
    </div>
  )
}
