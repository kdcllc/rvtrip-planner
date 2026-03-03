import './TripPrintLayout.css'
import type { TripPrintData, TripWeatherSummary } from '../../domain/trip/print'
import { formatDateRange, formatTime } from '../../utils/date'
import { formatDistance } from '../../utils/distance'

type TripPrintLayoutProps = {
  data: TripPrintData
  mapImageUrl?: string | null
}

const formatTemperature = (value: number) => `${Math.round(value)}F`

const formatWeatherCondition = (condition: TripWeatherSummary['condition']) => {
  switch (condition) {
    case 'sunny':
      return 'Sunny'
    case 'partly-cloudy':
      return 'Partly cloudy'
    case 'cloudy':
      return 'Cloudy'
    case 'rainy':
      return 'Rainy'
    case 'stormy':
      return 'Stormy'
    case 'snow':
      return 'Snow'
    default:
      return 'Unknown'
  }
}

const formatWeatherSummary = (summary?: TripWeatherSummary) => {
  if (!summary) {
    return 'No weather summary available'
  }

  const tempRange = `${formatTemperature(summary.minTemp)} - ${formatTemperature(summary.maxTemp)}`
  const precipLabel =
    summary.precipChance === null
      ? 'Precipitation: n/a'
      : `Precipitation up to ${Math.round(summary.precipChance)}%`
  const conditionLabel = formatWeatherCondition(summary.condition)

  return `${tempRange}. ${precipLabel}. ${conditionLabel}.`
}

const formatDeltaCurrency = (value?: number) => {
  if (value === undefined) {
    return 'N/A'
  }

  if (value > 0) {
    return `+$${value.toFixed(2)}`
  }

  if (value < 0) {
    return `-$${Math.abs(value).toFixed(2)}`
  }

  return '$0.00'
}

export const TripPrintLayout = ({ data, mapImageUrl }: TripPrintLayoutProps) => {
  const exportedDate = new Date(data.exportedAt)
  const exportedLabel = Number.isNaN(exportedDate.getTime())
    ? data.exportedAt
    : exportedDate.toLocaleDateString()

  return (
    <div className="trip-print">
      <header className="trip-print-header">
        <div>
          <p className="trip-print-eyebrow">Trip summary</p>
          <h1 className="trip-print-title">{data.tripName}</h1>
          {data.selectionNote ? (
            <p className="trip-print-selection">{data.selectionNote}</p>
          ) : null}
        </div>
        <div className="trip-print-meta">
          <p>Exported: {exportedLabel}</p>
          <p>Total stops: {data.stops.length}</p>
        </div>
      </header>

      <section className="trip-print-map">
        {mapImageUrl ? (
          <img src={mapImageUrl} alt="Trip map" />
        ) : (
          <div className="trip-print-map-placeholder">Map unavailable</div>
        )}
      </section>

      <section className="trip-print-summary">
        <div>
          <p className="summary-label">Total distance</p>
          <p className="summary-value">
            {data.totalDistanceMeters !== undefined
              ? formatDistance(data.totalDistanceMeters)
              : 'N/A'}
          </p>
        </div>
        <div>
          <p className="summary-label">Estimated fuel cost</p>
          <p className="summary-value">
            {data.totalFuelCost && data.totalFuelCost > 0
              ? `$${data.totalFuelCost.toFixed(2)}`
              : 'N/A'}
          </p>
        </div>
        <div>
          <p className="summary-label">Accommodation cost</p>
          <p className="summary-value">
            {data.totalAccommodationCost && data.totalAccommodationCost > 0
              ? `$${data.totalAccommodationCost.toFixed(2)}`
              : 'N/A'}
          </p>
        </div>
        <div>
          <p className="summary-label">Actual stop expenses</p>
          <p className="summary-value">
            {data.totalActualCost !== undefined
              ? `$${data.totalActualCost.toFixed(2)}`
              : 'N/A'}
          </p>
        </div>
        <div>
          <p className="summary-label">Actual gas</p>
          <p className="summary-value">
            {data.totalActualGasCost !== undefined
              ? `$${data.totalActualGasCost.toFixed(2)}`
              : 'N/A'}
          </p>
        </div>
        <div>
          <p className="summary-label">Actual food</p>
          <p className="summary-value">
            {data.totalActualFoodCost !== undefined
              ? `$${data.totalActualFoodCost.toFixed(2)}`
              : 'N/A'}
          </p>
        </div>
        <div>
          <p className="summary-label">Actual misc</p>
          <p className="summary-value">
            {data.totalActualMiscCost !== undefined
              ? `$${data.totalActualMiscCost.toFixed(2)}`
              : 'N/A'}
          </p>
        </div>
        <div>
          <p className="summary-label">Fuel delta (Est vs Actual)</p>
          <p className="summary-value">{formatDeltaCurrency(data.totalFuelDelta)}</p>
        </div>
      </section>

      <section className="trip-print-stops">
        <h2>Stops</h2>
        <ol className="print-stop-list">
          {data.stops.map((stop, index) => (
            <li key={stop.id} className="print-stop">
              <div className="print-stop-header">
                <div>
                  <h3>{stop.label}</h3>
                  <p className="muted">{stop.address}</p>
                  <p className="dates">{formatDateRange(stop.startDate, stop.endDate)}</p>
                  {(stop.checkInTime || stop.checkOutTime) && (
                    <p className="times">
                      {stop.checkInTime && `Check-in: ${formatTime(stop.checkInTime)}`}
                      {stop.checkInTime && stop.checkOutTime && ' | '}
                      {stop.checkOutTime && `Check-out: ${formatTime(stop.checkOutTime)}`}
                    </p>
                  )}
                </div>
                <div className="print-stop-index">Stop {index + 1}</div>
              </div>

              <div className="print-stop-details">
                {stop.distanceFromPreviousMeters ? (
                  <p>
                    <strong>Distance from previous:</strong>{' '}
                    {formatDistance(stop.distanceFromPreviousMeters)}
                  </p>
                ) : null}
                {stop.estimatedFuelCost !== undefined && stop.estimatedFuelCost > 0 ? (
                  <p>
                    <strong>Estimated fuel cost:</strong> ${stop.estimatedFuelCost.toFixed(2)}
                  </p>
                ) : null}
                {stop.nightlyCost ? (
                  <p>
                    <strong>Nightly cost:</strong> ${stop.nightlyCost.toFixed(2)}
                  </p>
                ) : null}
                {stop.actualGasCost !== undefined ? (
                  <p>
                    <strong>Actual gas:</strong> ${stop.actualGasCost.toFixed(2)}
                  </p>
                ) : null}
                {stop.actualFoodCost !== undefined ? (
                  <p>
                    <strong>Actual food:</strong> ${stop.actualFoodCost.toFixed(2)}
                  </p>
                ) : null}
                {stop.actualMiscCost !== undefined ? (
                  <p>
                    <strong>Actual misc:</strong> ${stop.actualMiscCost.toFixed(2)}
                  </p>
                ) : null}
                <p>
                  <strong>Weather:</strong> {formatWeatherSummary(stop.weatherSummary)}
                </p>
                {stop.source ? (
                  <p>
                    <strong>Source:</strong> {stop.source.name}
                    {stop.source.siteType ? ` | ${stop.source.siteType}` : ''}
                    {stop.source.fees ? ` | Fees: ${stop.source.fees}` : ''}
                  </p>
                ) : null}
                {stop.reservationStatus === 'reserved' ? (
                  <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(0, 0, 0, 0.1)' }}>
                    <p style={{ marginBottom: '4px' }}>
                      <strong>Reservation Details</strong>
                    </p>
                    {stop.confirmationNumber && (
                      <p style={{ margin: '2px 0' }}>
                        Confirmation #: {stop.confirmationNumber}
                      </p>
                    )}
                    {stop.siteNumber && (
                      <p style={{ margin: '2px 0' }}>
                        Site #: {stop.siteNumber}
                      </p>
                    )}
                    {stop.contactPhone && (
                      <p style={{ margin: '2px 0' }}>
                        Contact: {stop.contactPhone}
                      </p>
                    )}
                    {stop.reservationNote && (
                      <p style={{ margin: '2px 0' }}>
                        {stop.reservationNote}
                      </p>
                    )}
                  </div>
                ) : null}
                {stop.note ? (
                  <p>
                    <strong>Notes:</strong> {stop.note}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
