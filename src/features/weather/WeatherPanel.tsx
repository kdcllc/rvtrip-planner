import { formatDate, formatDateRange } from '../../utils/date'
import type { TripStop } from '../../domain/trip/types'
import type { StopForecast } from '../../domain/weather/types'
import { WeatherIcon } from '../../components/common/WeatherIcon'

type WeatherPanelProps = {
  stops: TripStop[]
  weatherByStopId: Record<string, StopForecast>
  weatherErrors: Record<string, string>
}

export const WeatherPanel = ({
  stops,
  weatherByStopId,
  weatherErrors,
}: WeatherPanelProps) => {
  return (
    <div className="weather-wrap">
      <div className="panel-header">
        <div>
          <h2>Weather outlook</h2>
          <p>NOAA forecast (16 days) + historical climate normals (month ahead).</p>
        </div>
        <span className="chip">Daily forecast</span>
      </div>

      {stops.length === 0 ? (
        <div className="empty-state">
          <p>Add trip stops to see the forecast timeline.</p>
        </div>
      ) : (
        <div className="weather-grid">
          {stops.map((stop) => {
            const forecast = weatherByStopId[stop.id]
            const error = weatherErrors[stop.id]

            return (
              <article key={stop.id} className="weather-card">
                <div className="weather-card-header">
                  <div>
                    <h3>{stop.label}</h3>
                    <p className="muted">{formatDateRange(stop.startDate, stop.endDate)}</p>
                    {forecast?.forecastUrl ? (
                      <a
                        className="source-link forecast-link"
                        href={forecast.forecastUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View NOAA forecast
                      </a>
                    ) : null}
                  </div>
                  <span className={`pill pill-${stop.status ?? 'idle'}`}>
                    {stop.status === 'ready' && 'Located'}
                    {stop.status === 'geocoding' && 'Locating'}
                    {stop.status === 'error' && 'No map match'}
                    {(!stop.status || stop.status === 'idle') && 'Pending'}
                  </span>
                </div>

                {error ? (
                  <p className="form-error">{error}</p>
                ) : !stop.startDate || !stop.endDate ? (
                  <p className="muted">Add dates to pull a forecast.</p>
                ) : forecast ? (
                  <div className="forecast-list">
                    {forecast.days.map((day) => (
                      <div key={day.date} className="forecast-row">
                        <WeatherIcon
                          condition={day.weatherCondition ?? 'unknown'}
                          size="md"
                        />
                        <span>{formatDate(day.date)}</span>
                        <span className="temp-range">
                          {Math.round(day.min)} - {Math.round(day.max)}
                          <span className="unit"> F</span>
                        </span>
                        <span className="precip">
                          {day.precipChance === null
                            ? 'No data'
                            : `${day.precipChance}% precip`}
                        </span>
                        {day.isHistorical && <span className="historical-badge">avg</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">Waiting for map coordinates.</p>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
