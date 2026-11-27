import type { TripStop } from '../../domain/trip/types'
import type { DailyForecast, StopForecast } from '../../domain/weather/types'
import { WeatherIcon } from '../../components/common/WeatherIcon'
import './StopWeatherForecast.css'

type StopWeatherForecastProps = {
  stop: TripStop
  forecast: StopForecast | undefined
  error: string | undefined
}

const formatWeekday = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
  })

const formatShortDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })

const buildSummary = (days: DailyForecast[]) => {
  const lo = Math.round(Math.min(...days.map((day) => day.min)))
  const hi = Math.round(Math.max(...days.map((day) => day.max)))
  const chances = days
    .map((day) => day.precipChance)
    .filter((chance): chance is number => chance !== null)
  const rain = chances.length > 0 ? ` · up to ${Math.max(...chances)}% rain` : ''
  return `${lo}–${hi}°F${rain}`
}

const buildSpokenDay = (day: DailyForecast) => {
  const precip =
    day.precipChance === null
      ? 'precipitation unknown'
      : `${day.precipChance}% chance of precipitation`
  const historical = day.isHistorical ? ', historical average' : ''
  return `${formatWeekday(day.date)}, ${formatShortDate(day.date)}: high ${Math.round(day.max)} degrees, low ${Math.round(day.min)} degrees, ${precip}${historical}`
}

const buildNote = (days: DailyForecast[]) => {
  const historicalCount = days.filter((day) => day.isHistorical).length
  if (historicalCount === 0) {
    return null
  }
  return historicalCount === days.length
    ? 'Historical averages'
    : 'Dashed days are historical averages'
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

  const label = `Weather for ${stop.label}`

  if (error) {
    return (
      <section className="stop-weather" aria-label={label}>
        <p className="form-error">{error}</p>
      </section>
    )
  }

  if (!forecast) {
    return (
      <section className="stop-weather" aria-label={label}>
        <p className="muted">Waiting for map coordinates.</p>
      </section>
    )
  }

  const hasDays = forecast.days.length > 0
  const note = hasDays ? buildNote(forecast.days) : null

  return (
    <section className="stop-weather" aria-label={label}>
      <div className="forecast-header">
        <span className="forecast-title">Weather</span>
        {hasDays ? (
          <span className="forecast-summary">{buildSummary(forecast.days)}</span>
        ) : null}
        {forecast.forecastUrl ? (
          <a
            className="source-link forecast-link"
            href={forecast.forecastUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`NOAA forecast for ${stop.label} (opens in a new tab)`}
          >
            NOAA
          </a>
        ) : null}
      </div>
      {hasDays ? (
        <>
          <ul className="forecast-strip" tabIndex={0} aria-label="Daily forecast">
            {forecast.days.map((day) => (
              <li
                key={day.date}
                className={
                  day.isHistorical
                    ? 'forecast-day forecast-day--historical'
                    : 'forecast-day'
                }
              >
                <span className="forecast-sr-only">{buildSpokenDay(day)}</span>
                <span className="forecast-day-visual" aria-hidden="true">
                  <span className="forecast-day-weekday">
                    {formatWeekday(day.date)}
                  </span>
                  <span className="forecast-day-date">
                    {formatShortDate(day.date)}
                  </span>
                  <WeatherIcon
                    condition={day.weatherCondition ?? 'unknown'}
                    size="sm"
                  />
                  <span className="forecast-day-high">{Math.round(day.max)}°</span>
                  <span className="forecast-day-low">{Math.round(day.min)}°</span>
                  <span className="forecast-day-precip">
                    {day.precipChance === null ? '—' : `${day.precipChance}%`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {note ? <p className="forecast-note">{note}</p> : null}
        </>
      ) : (
        <p className="muted">No forecast data.</p>
      )}
    </section>
  )
}
