import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { requiresCheckInOut } from '../../utils/siteType'
import { formatDistance } from '../../utils/distance'
import { CampsiteSearch } from './CampsiteSearch'
import type { TripStopSourceName } from '../../domain/trip/types'
import { STOP_NOTE_MAX_LENGTH } from '../../domain/trip/stopFields'
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
  location: { lat: number; lng: number } | null
  // Reservation fields
  reservationStatus: string
  confirmationNumber: string
  siteNumber: string
  contactPhone: string
  nightlyCost: string
  actualGasCost: string
  actualFoodCost: string
  actualMiscCost: string
}

export type StopFormValidationState = {
  status: 'idle' | 'validating' | 'valid' | 'invalid'
  message: string
  lastValidatedAddress: string
  predictionStatus: 'idle' | 'loading' | 'empty' | 'blocked'
}

/** The field a save error belongs to; drives inline message, aria wiring and focus. */
export type StopFormErrorField = 'address' | 'dates' | 'checkOutTime'

type StopFormFieldValue = string | boolean | { lat: number; lng: number }

type StopFormFieldsProps = {
  isEditing?: boolean
  values: Partial<StopFormValues>
  predictions: SuggestionItem[]
  mapBounds?: MapBounds
  validationState?: StopFormValidationState
  error?: string
  errorField?: StopFormErrorField | null
  /** Changes on every failed save so focus moves even when the same error repeats. */
  errorKey?: number
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

const NOTE_WARN_THRESHOLD = 50

const hasText = (value: string | undefined) => (value || '').trim() !== ''

const formatMoney = (value: string | undefined) => {
  const parsed = Number.parseFloat(value || '')
  if (!Number.isFinite(parsed)) {
    return ''
  }
  return `$${Number.isInteger(parsed) ? parsed : parsed.toFixed(2)}`
}

const staySummary = (values: Partial<StopFormValues>) => {
  const parts: string[] = []
  if (values.reservationStatus === 'reserved') {
    parts.push('Reserved')
  }
  const nightly = formatMoney(values.nightlyCost)
  if (nightly) {
    parts.push(`${nightly}/night`)
  }
  if (parts.length === 0) {
    const fallback = values.sourceName || values.sourceSiteType
    if (fallback) {
      parts.push(fallback)
    }
  }
  return parts.join(' · ')
}

const hasStayData = (values: Partial<StopFormValues>) =>
  Boolean(values.sourceName) ||
  hasText(values.sourceUrl) ||
  hasText(values.sourceSiteType) ||
  hasText(values.nightlyCost) ||
  hasText(values.confirmationNumber) ||
  hasText(values.siteNumber) ||
  hasText(values.contactPhone) ||
  values.reservationStatus === 'reserved'

const hasActualCosts = (values: Partial<StopFormValues>) =>
  hasText(values.actualGasCost) ||
  hasText(values.actualFoodCost) ||
  hasText(values.actualMiscCost)

type SectionProps = {
  id: string
  title: string
  summary?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}

const FormSection = ({ id, title, summary, open, onOpenChange, children }: SectionProps) => (
  <details
    className="form-section"
    id={id}
    open={open}
    onToggle={(event) => onOpenChange(event.currentTarget.open)}
  >
    <summary>
      <span className="form-section-title">{title}</span>
      {summary ? <span className="form-section-summary">{summary}</span> : null}
    </summary>
    <div className="form-section-body">{children}</div>
  </details>
)

export const StopFormFields = ({
  isEditing = false,
  values,
  predictions,
  mapBounds,
  validationState,
  error,
  errorField = null,
  errorKey = 0,
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
  const uid = useId()
  const ids = {
    address: `${uid}-address`,
    addressError: `${uid}-address-error`,
    manualHint: `${uid}-manual-hint`,
    title: `${uid}-title`,
    titleHint: `${uid}-title-hint`,
    startPoint: `${uid}-start-point`,
    startDate: `${uid}-start-date`,
    endDate: `${uid}-end-date`,
    dateError: `${uid}-date-error`,
    checkOut: `${uid}-check-out`,
    checkOutError: `${uid}-check-out-error`,
  }

  // Sections open by default only when editing a stop that already holds data.
  // Initial state only: typing never re-collapses or re-opens a section.
  const [stayOpen, setStayOpen] = useState(() => isEditing && hasStayData(values))
  const [notesOpen, setNotesOpen] = useState(() => isEditing && hasText(values.note))
  const [costsOpen, setCostsOpen] = useState(() => isEditing && hasActualCosts(values))

  // Move focus to the field a failed save concerns, opening its section first.
  useEffect(() => {
    if (!errorKey || !errorField) {
      return
    }
    if (errorField === 'checkOutTime') {
      setStayOpen(true)
    }
    const targetId =
      errorField === 'address'
        ? ids.address
        : errorField === 'dates'
          ? ids.startDate
          : ids.checkOut
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorKey])

  const actualGasCost = Number.parseFloat(values.actualGasCost || '0') || 0
  const actualFoodCost = Number.parseFloat(values.actualFoodCost || '0') || 0
  const actualMiscCost = Number.parseFloat(values.actualMiscCost || '0') || 0
  const actualStopTotal = actualGasCost + actualFoodCost + actualMiscCost

  const addressError = errorField === 'address' && error ? error : ''
  const dateError = errorField === 'dates' && error ? error : ''
  const checkOutError = errorField === 'checkOutTime' && error ? error : ''
  const noteLength = (values.note || '').length
  const noteRemaining = STOP_NOTE_MAX_LENGTH - noteLength
  const noteSummary = hasText(values.note) ? '1 note' : ''
  const isReserved = values.reservationStatus === 'reserved'
  const siteTypeOptions =
    values.sourceName && SITE_TYPES_BY_SOURCE[values.sourceName as TripStopSourceName]
      ? SITE_TYPES_BY_SOURCE[values.sourceName as TripStopSourceName]
      : !values.sourceName
        ? ALL_SITE_TYPES
        : []

  return (
    <div className="form-grid">
      <div className="field">
        <label htmlFor={ids.address}>
          Address <span className="required-mark" aria-hidden="true">*</span>
        </label>
        <div className="address-field">
          <input
            id={ids.address}
            name="address"
            spellCheck={false}
            autoComplete="off"
            ref={ref}
            value={values.address || ''}
            onChange={(event) => onFieldChange('address', event.target.value)}
            placeholder="Grand Canyon Village, AZ…"
            aria-required="true"
            aria-invalid={addressError ? 'true' : undefined}
            aria-describedby={addressError ? ids.addressError : undefined}
          />
          {addressError && (
            <p id={ids.addressError} className="field-error" role="alert">
              {addressError}
            </p>
          )}
          {isValidatingAddress && (
            <p className="address-validation-message validating" role="status">
              Validating address…
            </p>
          )}
          {!isValidatingAddress && validationState?.message && validationState.lastValidatedAddress === values.address && (
            <p
              className={`address-validation-message ${validationState.status === 'invalid' ? 'invalid' : 'valid'}`}
              role="status"
            >
              {validationState.message}
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
        <div className="address-actions">
          <button
            className="text-button"
            type="button"
            aria-describedby={values.manualAddress ? ids.manualHint : undefined}
            onClick={() => onFieldChange('manualAddress', !values.manualAddress)}
          >
            {values.manualAddress ? 'Use address search instead' : "Can't find it? Enter manually"}
          </button>
          {!values.manualAddress && values.address && predictions.length === 0 && onValidateCurrentAddress && (
            <button
              className="text-button"
              type="button"
              onClick={onValidateCurrentAddress}
              disabled={isValidatingAddress}
              title="Validate this address without selecting from suggestions"
            >
              {isValidatingAddress ? 'Validating…' : 'Validate'}
            </button>
          )}
        </div>
        {values.manualAddress && (
          <p id={ids.manualHint} className="manual-address-hint muted" role="status">
            Manual entry: address validation is skipped.
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor={ids.title}>Stop title</label>
        <input
          id={ids.title}
          name="label"
          autoComplete="off"
          value={values.label || ''}
          onChange={(event) => onFieldChange('label', event.target.value)}
          placeholder="Grand Canyon Village…"
          disabled={values.isStartPoint}
          aria-describedby={values.isStartPoint ? undefined : ids.titleHint}
        />
        {!values.isStartPoint && (
          <p id={ids.titleHint} className="muted">
            Optional. Filled in from the address if left blank.
          </p>
        )}
        <label className="checkbox-row" htmlFor={ids.startPoint}>
          <input
            id={ids.startPoint}
            name="isStartPoint"
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
          <span>Starting point</span>
        </label>
      </div>

      <div className="field-group">
        <div className="field-row">
          <div className="field">
            <label htmlFor={ids.startDate}>Arrival</label>
            <input
              id={ids.startDate}
              name="startDate"
              type="date"
              value={values.startDate || ''}
              onChange={(event) => onFieldChange('startDate', event.target.value)}
              disabled={values.isStartPoint}
              aria-invalid={dateError ? 'true' : undefined}
              aria-describedby={dateError ? ids.dateError : undefined}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.endDate}>
              {values.isStartPoint ? 'Departure (used for weather)' : 'Departure'}
            </label>
            <input
              id={ids.endDate}
              name="endDate"
              type="date"
              value={values.endDate || ''}
              onChange={(event) => {
                const nextDate = event.target.value
                onFieldChange('endDate', nextDate)
                if (values.isStartPoint) {
                  onFieldChange('startDate', nextDate)
                }
              }}
              aria-invalid={dateError ? 'true' : undefined}
              aria-describedby={dateError ? ids.dateError : undefined}
            />
          </div>
        </div>
        {dateError && (
          <p id={ids.dateError} className="field-error" role="alert">
            {dateError}
          </p>
        )}
      </div>

      <FormSection
        id={`${uid}-stay`}
        title="Stay"
        summary={staySummary(values)}
        open={stayOpen}
        onOpenChange={setStayOpen}
      >
        {!isEditing && mapBounds && (
          <CampsiteSearch
            address={values.address || ''}
            mapBounds={mapBounds}
            location={values.location}
          />
        )}
        <div className="field">
          <label htmlFor={`${uid}-source-name`}>Source name</label>
          <select
            id={`${uid}-source-name`}
            name="sourceName"
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
        </div>
        <div className="field">
          <label htmlFor={`${uid}-source-url`}>Listing URL</label>
          <div className="listing-url-row">
            <input
              id={`${uid}-source-url`}
              name="sourceUrl"
              spellCheck={false}
              type="url"
              inputMode="url"
              autoComplete="url"
              value={values.sourceUrl || ''}
              onChange={(event) => onFieldChange('sourceUrl', event.target.value)}
              placeholder="https://…"
            />
            <button
              className="ghost small"
              type="button"
              onClick={onGenerateSourceUrl}
            >
              Generate TruckMap URL
            </button>
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${uid}-site-type`}>Site type</label>
          <select
            id={`${uid}-site-type`}
            name="sourceSiteType"
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
                ? 'Select a site type…'
                : 'Select source first or choose type…'}
            </option>
            {siteTypeOptions.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>
        {requiresCheckInOut(values.sourceSiteType) && (
          <div className="field-group">
            <div className="field-row">
              <div className="field">
                <label htmlFor={`${uid}-check-in`}>Check-in time</label>
                <input
                  id={`${uid}-check-in`}
                  name="checkInTime"
                  type="time"
                  value={values.checkInTime || ''}
                  onChange={(event) => onFieldChange('checkInTime', event.target.value)}
                  disabled={values.isStartPoint}
                />
              </div>
              <div className="field">
                <label htmlFor={ids.checkOut}>Check-out time</label>
                <input
                  id={ids.checkOut}
                  name="checkOutTime"
                  type="time"
                  value={values.checkOutTime || ''}
                  onChange={(event) => onFieldChange('checkOutTime', event.target.value)}
                  aria-invalid={checkOutError ? 'true' : undefined}
                  aria-describedby={checkOutError ? ids.checkOutError : undefined}
                />
              </div>
            </div>
            {checkOutError && (
              <p id={ids.checkOutError} className="field-error" role="alert">
                {checkOutError}
              </p>
            )}
          </div>
        )}
        <div className="field">
          <label htmlFor={`${uid}-nightly`}>Nightly cost</label>
          <input
            id={`${uid}-nightly`}
            name="nightlyCost"
            spellCheck={false}
            autoComplete="off"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={values.nightlyCost || ''}
            onChange={(event) => onFieldChange('nightlyCost', event.target.value)}
            placeholder="35.00…"
          />
        </div>
        <div className="field">
          <label htmlFor={`${uid}-reservation-status`}>Reservation status</label>
          <select
            id={`${uid}-reservation-status`}
            name="reservationStatus"
            value={values.reservationStatus || 'unreserved'}
            onChange={(event) => onFieldChange('reservationStatus', event.target.value)}
          >
            <option value="unreserved">Unreserved</option>
            <option value="reserved">Reserved</option>
          </select>
        </div>
        {isReserved && (
          <>
            <div className="field">
              <label htmlFor={`${uid}-confirmation`}>Confirmation number</label>
              <input
                id={`${uid}-confirmation`}
                name="confirmationNumber"
                spellCheck={false}
                type="text"
                autoComplete="off"
                value={values.confirmationNumber || ''}
                onChange={(event) => onFieldChange('confirmationNumber', event.target.value)}
                placeholder="RES-12345…"
              />
            </div>
            <div className="field">
              <label htmlFor={`${uid}-site-number`}>Site number</label>
              <input
                id={`${uid}-site-number`}
                name="siteNumber"
                spellCheck={false}
                type="text"
                autoComplete="off"
                value={values.siteNumber || ''}
                onChange={(event) => onFieldChange('siteNumber', event.target.value)}
                placeholder="A-42…"
              />
            </div>
            <div className="field">
              <label htmlFor={`${uid}-phone`}>Contact phone</label>
              <input
                id={`${uid}-phone`}
                name="contactPhone"
                spellCheck={false}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={values.contactPhone || ''}
                onChange={(event) => onFieldChange('contactPhone', event.target.value)}
                placeholder="(555) 123-4567…"
              />
            </div>
          </>
        )}
      </FormSection>

      <FormSection
        id={`${uid}-notes`}
        title="Notes"
        summary={noteSummary}
        open={notesOpen}
        onOpenChange={setNotesOpen}
      >
        <div className="field">
          <div className="label-row">
            <label htmlFor={`${uid}-note`}>Note</label>
            <span className="note-count">
              {noteLength}/{STOP_NOTE_MAX_LENGTH}
            </span>
          </div>
          <p className="visually-hidden" role="status">
            {noteRemaining <= NOTE_WARN_THRESHOLD
              ? noteRemaining === 0
                ? 'Character limit reached.'
                : `${noteRemaining} characters left.`
              : ''}
          </p>
          <textarea
            id={`${uid}-note`}
            name="note"
            autoComplete="off"
            value={values.note || ''}
            onChange={(event) =>
              onFieldChange('note', event.target.value.slice(0, STOP_NOTE_MAX_LENGTH))
            }
            maxLength={STOP_NOTE_MAX_LENGTH}
            rows={4}
            placeholder="Parking details, check-in info, reminders…"
          />
        </div>
      </FormSection>

      {isEditing && (
        <FormSection
          id={`${uid}-costs`}
          title="Travel & costs"
          open={costsOpen}
          onOpenChange={setCostsOpen}
        >
          <dl className="readonly-list">
            <div className="readonly-item">
              <dt>Distance to this stop</dt>
              <dd>
                {distanceFromPreviousMeters
                  ? formatDistance(distanceFromPreviousMeters)
                  : 'Data not available'}
              </dd>
            </div>
            <div className="readonly-item">
              <dt>Estimated fuel cost</dt>
              <dd>
                {estimatedFuelCost !== undefined && estimatedFuelCost > 0
                  ? `$${estimatedFuelCost.toFixed(2)}`
                  : 'Data not available'}
              </dd>
            </div>
          </dl>
          <div className="field">
            <label htmlFor={`${uid}-gas`}>Actual gas cost</label>
            <input
              id={`${uid}-gas`}
              name="actualGasCost"
              spellCheck={false}
              autoComplete="off"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={values.actualGasCost || ''}
              onChange={(event) => onFieldChange('actualGasCost', event.target.value)}
              placeholder="62.50…"
            />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-food`}>Actual food cost</label>
            <input
              id={`${uid}-food`}
              name="actualFoodCost"
              spellCheck={false}
              autoComplete="off"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={values.actualFoodCost || ''}
              onChange={(event) => onFieldChange('actualFoodCost', event.target.value)}
              placeholder="48.25…"
            />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-misc`}>Actual misc cost</label>
            <input
              id={`${uid}-misc`}
              name="actualMiscCost"
              spellCheck={false}
              autoComplete="off"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={values.actualMiscCost || ''}
              onChange={(event) => onFieldChange('actualMiscCost', event.target.value)}
              placeholder="15.00…"
            />
          </div>
          <dl className="readonly-list">
            <div className="readonly-item">
              <dt>Actual stop total</dt>
              <dd>${actualStopTotal.toFixed(2)}</dd>
            </div>
          </dl>
        </FormSection>
      )}

      {children}
    </div>
  )
}
