import { formatDate } from '../../utils/date'
import type { TripStop } from '../trip/types'
import type { StopForecast } from './types'

type StopWeatherForecastProps = {
  stop: TripStop
  forecast: StopForecast | undefined
  error: string | undefined
}

export const StopWeatherForecast = ({
  stop,
  forecast,
  error,
}: StopWeatherForecastProps) => {
  // Only show weather if stop is ready and has dates
  if (!stop.startDate || !stop.endDate || stop.status !== 'ready') {
    return null
  }

  return (
    <div className="stop-weather">
      {error ? (
        <p className="form-error">{error}</p>
      ) : forecast ? (
        <div className="forecast-list">
          {forecast.days.map((day) => (
            <div key={day.date} className="forecast-row">
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
    </div>
  )
}
