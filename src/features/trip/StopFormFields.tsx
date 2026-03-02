import { useRef, type ReactNode } from 'react'
import { requiresCheckInOut } from '../../utils/siteType'
import { formatDistance } from '../../utils/distance'
import { CampsiteSearch } from './CampsiteSearch'
import type { TripStopSourceName } from '../../domain/trip/types'
import type { MapBounds } from '../../services/campsiteSearch'

export type SuggestionItem = {
  id: string
  mainText: string
  secondaryText: string
  location?: { lat: number; lng: number }
}

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

export type StopFormValues = {
  label: string
  address: string
  startDate: string
  endDate: string
  checkInTime: string
  checkOutTime: string
  note: string
  isStartPoint?: boolean
  manualAddress?: boolean
  sourceName: TripStopSourceName | ''
  sourceUrl: string
  sourceSiteType: string
  sourceFees: string
  sourceAmenities: string
  location: { lat: number; lng: number } | null
  // Reservation fields
  reservationStatus: string
  confirmationNumber: string
  siteNumber: string
  contactPhone: string
  nightlyCost: string
  reservationNote: string
}

export type StopFormValidationState = {
  status: 'idle' | 'validating' | 'valid' | 'invalid'
  message: string
  lastValidatedAddress: string
  predictionStatus: 'idle' | 'loading' | 'empty' | 'blocked'
}

type StopFormFieldValue = string | boolean | { lat: number; lng: number }

type StopFormFieldsProps = {
  isEditing?: boolean
  values: Partial<StopFormValues>
  predictions: SuggestionItem[]
  mapBounds?: MapBounds
  validationState?: StopFormValidationState
  error?: string
  onFieldChange: (field: keyof StopFormValues, value: StopFormFieldValue) => void
  onSelectPrediction: (item: SuggestionItem) => void
  onGenerateSourceUrl: () => void
  onValidateCurrentAddress?: () => void
  isValidatingAddress?: boolean
  addressInputRef?: React.RefObject<HTMLInputElement>
  distanceFromPreviousMeters?: number
  estimatedFuelCost?: number
  children?: ReactNode
}

export const StopFormFields = ({
  isEditing = false,
  values,
  predictions,
  mapBounds,
  validationState,
  error,
  onFieldChange,
  onSelectPrediction,
  onGenerateSourceUrl,
  onValidateCurrentAddress,
  isValidatingAddress,
  addressInputRef,
  distanceFromPreviousMeters,
  estimatedFuelCost,
  children,
}: StopFormFieldsProps) => {
  const internalAddressRef = useRef<HTMLInputElement | null>(null)
  const ref = addressInputRef || internalAddressRef

  // Map error messages to fields
  const errorMap = {
    titleError: error?.toLowerCase().includes('title') || error?.toLowerCase().includes('label'),
    addressError: error?.toLowerCase().includes('address'),
    dateError: error?.toLowerCase().includes('date') || error?.toLowerCase().includes('arrival') || error?.toLowerCase().includes('departure'),
    timeError: error?.toLowerCase().includes('check-in') || error?.toLowerCase().includes('check-out'),
  }

  return (
    <div className="form-grid">
      {!isEditing && (
        <label>
          Stop title
          <input
            value={values.label || ''}
            onChange={(event) => onFieldChange('label', event.target.value)}
            placeholder="Grand Canyon Village"
            disabled={values.isStartPoint}
          />
          {errorMap.titleError && <p className="field-error">{error}</p>}
        </label>
      )}
      {!isEditing && (
        <label>
          Starting point
          <input
            type="checkbox"
            checked={values.isStartPoint || false}
            onChange={(event) => {
              const checked = event.target.checked
              onFieldChange('isStartPoint', checked)
              if (checked && values.endDate) {
                onFieldChange('startDate', values.endDate)
              }
            }}
          />
        </label>
      )}
      {isEditing && (
        <label>
          Stop title
          <input
            value={values.label || ''}
            onChange={(event) => onFieldChange('label', event.target.value)}
            placeholder="Grand Canyon Village"
          />
        </label>
      )}
      <label>
        <span className="label-row">
          Address
          {!values.manualAddress && values.address && predictions.length === 0 && onValidateCurrentAddress && (
            <button
              className="ghost-compact"
              type="button"
              onClick={onValidateCurrentAddress}
              disabled={isValidatingAddress}
              title="Validate this address without selecting from suggestions"
            >
              {isValidatingAddress ? 'Validating...' : 'Validate'}
            </button>
          )}
        </span>
        <div className="address-field">
          <input
            ref={ref}
            value={values.address || ''}
            onChange={(event) => {
              onFieldChange('address', event.target.value)
            }}
            onBlur={() => {
              window.setTimeout(() => {
                if (predictions.length === 0) {
                  // Trigger validation through parent callback if needed
                }
              }, 150)
            }}
            placeholder="Grand Canyon Village, AZ"
          />
          {isValidatingAddress && (
            <p className="address-validation-message validating">
              Validating address...
            </p>
          )}
          {!isValidatingAddress && validationState?.message && validationState.lastValidatedAddress === values.address && (
            <p
              className={`address-validation-message ${validationState.status === 'invalid' ? 'invalid' : 'valid'}`}
            >
              {validationState.message}
            </p>
          )}
          {!isValidatingAddress && !validationState?.message && errorMap.addressError && (
            <p className="address-validation-message invalid">
              {error}
            </p>
          )}
          {predictions.length > 0 && !values.manualAddress ? (
            <div className="address-suggestions" role="listbox">
              {predictions.map((prediction) => (
                <button
                  key={prediction.id}
                  className="address-suggestion"
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => onSelectPrediction(prediction)}
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
        Manual address entry
        <input
          type="checkbox"
          checked={values.manualAddress || false}
          onChange={(event) => {
            const checked = event.target.checked
            onFieldChange('manualAddress', checked)
          }}
        />
      </label>
      <p className="manual-address-hint muted" role="status" aria-live="polite">
        {values.manualAddress
          ? 'Manual entry is ON. Suggestions and required address validation are bypassed for this stop.'
          : 'Manual entry is OFF. Type an address and pick a suggestion to validate before saving.'}
      </p>
      <label>
        Arrival
        <input
          type="date"
          value={values.startDate || ''}
          onChange={(event) => onFieldChange('startDate', event.target.value)}
          disabled={values.isStartPoint}
        />
        {errorMap.dateError && <p className="field-error">{error}</p>}
      </label>
      <label>
        {values.isStartPoint ? 'Departure (used for weather)' : 'Departure'}
        <input
          type="date"
          value={values.endDate || ''}
          onChange={(event) => {
            const nextDate = event.target.value
            onFieldChange('endDate', nextDate)
            if (values.isStartPoint) {
              onFieldChange('startDate', nextDate)
            }
          }}
        />
      </label>
      {requiresCheckInOut(values.sourceSiteType) && (
        <>
          <label>
            Check-in time
            <input
              type="time"
              value={values.checkInTime || ''}
              onChange={(event) => onFieldChange('checkInTime', event.target.value)}
              placeholder="2:00 PM"
              disabled={values.isStartPoint}
            />
          </label>
          <label>
            Check-out time
            <input
              type="time"
              value={values.checkOutTime || ''}
              onChange={(event) => onFieldChange('checkOutTime', event.target.value)}
              placeholder="11:00 AM"
            />
            {errorMap.timeError && <p className="field-error">{error}</p>}
          </label>
        </>
      )}
      <label>
        <span className="label-row">
          Note (optional)
          <span className="note-count">{(values.note || '').length}/500</span>
        </span>
        <textarea
          value={values.note || ''}
          onChange={(event) =>
            onFieldChange('note', event.target.value.slice(0, 500))
          }
          maxLength={500}
          rows={3}
          placeholder="Add parking details, check-in info, or reminders."
        />
      </label>
      {!isEditing && mapBounds && (
        <CampsiteSearch
          address={values.address || ''}
          mapBounds={mapBounds}
          location={values.location}
        />
      )}
      <div className="source-section">
        <div className="source-header">
          <div>
            <p className="source-title">Campground source</p>
            <p className="muted">
              Open official sites, then paste key details for this stop.
            </p>
          </div>
        </div>
        <label>
          Source name
          <select
            value={values.sourceName || ''}
            onChange={(event) => {
              const newSourceName = event.target.value as TripStopSourceName
              onFieldChange('sourceName', newSourceName)
              onFieldChange('sourceSiteType', '')
              onFieldChange('checkInTime', '')
              onFieldChange('checkOutTime', '')
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
          <div className="listing-url-row">
            <input
              value={values.sourceUrl || ''}
              onChange={(event) => onFieldChange('sourceUrl', event.target.value)}
              placeholder="https://..."
            />
            <button
              className="ghost small"
              type="button"
              onClick={onGenerateSourceUrl}
            >
              Generate TruckMap URL
            </button>
          </div>
        </label>
        <label>
          Site type
          <select
            value={values.sourceSiteType || ''}
            onChange={(event) => {
              const nextSiteType = event.target.value
              onFieldChange('sourceSiteType', nextSiteType)

              if (requiresCheckInOut(nextSiteType)) {
                onFieldChange('checkInTime', values.checkInTime || '14:00')
                onFieldChange('checkOutTime', values.checkOutTime || '11:00')
              } else {
                onFieldChange('checkInTime', '')
                onFieldChange('checkOutTime', '')
              }
            }}
          >
            <option value="">
              {values.sourceName
                ? 'Select a site type...'
                : 'Select source first or choose type...'}
            </option>
            {values.sourceName &&
            SITE_TYPES_BY_SOURCE[values.sourceName as TripStopSourceName]
              ? SITE_TYPES_BY_SOURCE[
                  values.sourceName as TripStopSourceName
                ].map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))
              : !values.sourceName
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
            value={values.sourceFees || ''}
            onChange={(event) => onFieldChange('sourceFees', event.target.value)}
            placeholder="$35/night, membership required"
          />
        </label>
        <label>
          Amenities / notes
          <input
            value={values.sourceAmenities || ''}
            onChange={(event) =>
              onFieldChange('sourceAmenities', event.target.value)
            }
            placeholder="Water, 30A, pets allowed"
          />
        </label>
      </div>

      <div className="cost-section">
        <div className="cost-header">
          <p className="source-title">Travel Distance & Cost</p>
        </div>
        <label>
          Distance to this stop
          <div
            style={{
              padding: '10px 12px',
              backgroundColor: 'var(--color-surface-strong)',
              borderRadius: '12px',
              border: '1px solid var(--color-border)',
            }}
          >
            <p style={{ margin: 0, color: 'inherit' }}>
              {distanceFromPreviousMeters
                ? formatDistance(distanceFromPreviousMeters)
                : 'Data not available'}
            </p>
          </div>
        </label>
        <label>
          Estimated fuel cost
          <div
            style={{
              padding: '10px 12px',
              backgroundColor: 'var(--color-surface-strong)',
              borderRadius: '12px',
              border: '1px solid var(--color-border)',
            }}
          >
            <p style={{ margin: 0, color: 'inherit' }}>
              {estimatedFuelCost !== undefined && estimatedFuelCost > 0
                ? `$${estimatedFuelCost.toFixed(2)}`
                : 'Data not available'}
            </p>
          </div>
        </label>
      </div>

      <div className="reservation-section">
        <div className="reservation-header">
          <p className="source-title">Reservation Details (optional)</p>
        </div>
        <label>
          Reservation status
          <select
            value={values.reservationStatus || ''}
            onChange={(event) =>
              onFieldChange('reservationStatus', event.target.value)
            }
          >
            <option value="">Unreserved</option>
            <option value="reserved">Reserved</option>
            <option value="unreserved">Unreserved</option>
          </select>
        </label>
        <label>
          Confirmation number
          <input
            type="text"
            value={values.confirmationNumber || ''}
            onChange={(event) =>
              onFieldChange('confirmationNumber', event.target.value)
            }
            placeholder="e.g., RES-12345"
          />
        </label>
        <label>
          Site number
          <input
            type="text"
            value={values.siteNumber || ''}
            onChange={(event) => onFieldChange('siteNumber', event.target.value)}
            placeholder="e.g., A-42"
          />
        </label>
        <label>
          Contact phone
          <input
            type="tel"
            value={values.contactPhone || ''}
            onChange={(event) =>
              onFieldChange('contactPhone', event.target.value)
            }
            placeholder="e.g., (555) 123-4567"
          />
        </label>
        <label>
          Nightly cost
          <input
            type="number"
            step="0.01"
            min="0"
            value={values.nightlyCost || ''}
            onChange={(event) => onFieldChange('nightlyCost', event.target.value)}
            placeholder="e.g., 35.00"
          />
        </label>
        <label>
          <span className="label-row">
            Reservation note (optional)
            <span className="note-count">
              {(values.reservationNote || '').length}/200
            </span>
          </span>
          <textarea
            value={values.reservationNote || ''}
            onChange={(event) =>
              onFieldChange(
                'reservationNote',
                event.target.value.slice(0, 200),
              )
            }
            maxLength={200}
            rows={2}
            placeholder="Add any reservation-specific details or special instructions."
          />
        </label>
      </div>

      {children}
    </div>
  )
}
