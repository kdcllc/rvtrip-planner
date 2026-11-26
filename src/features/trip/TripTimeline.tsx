import { useMemo, useRef, useEffect, useState } from 'react'
import type { TripStop } from '../../domain/trip/types'
import {
  getTripDateRange,
  getDateMarkersForRange,
  getStopDatePosition,
  formatDateRange,
} from '../../utils/date'
import './TripTimeline.css'

type TripTimelineProps = {
  stops: TripStop[]
  onStopClick: (stopId: string) => void
  currentStopId: string | null
  actions?: React.ReactNode
}

const MS_PER_DAY = 1000 * 60 * 60 * 24

const describeNights = (nights: number) =>
  nights === 0
    ? 'pass-through stop'
    : `${nights} night${nights === 1 ? '' : 's'}`

export function TripTimeline({
  stops,
  onStopClick,
  currentStopId,
  actions,
}: TripTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const timelineData = useMemo(() => {
    const validStops = stops.filter((stop) => stop.startDate && stop.endDate)
    if (validStops.length < 2) {
      return null
    }

    const tripRange = getTripDateRange(stops)
    if (!tripRange) {
      return null
    }

    const { startDate, endDate, durationDays } = tripRange

    const bars = validStops.map((stop, index) => {
      let position = getStopDatePosition(stop.startDate, startDate, durationDays)

      // Offset stops that begin on the same date to reduce overlap
      for (let i = 0; i < index; i++) {
        if (validStops[i].startDate === stop.startDate) {
          position += 2
        }
      }

      const start = new Date(`${stop.startDate}T00:00:00`)
      const end = new Date(`${stop.endDate}T00:00:00`)
      const nights = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY)
      const widthPercent = nights > 0 ? (nights / durationDays) * 100 : 0

      return {
        id: stop.id,
        label: stop.label,
        dateRange: formatDateRange(stop.startDate, stop.endDate),
        position: Math.min(position, 100),
        nights,
        widthPercent,
      }
    })

    return {
      bars,
      dateMarkers: getDateMarkersForRange(startDate, endDate, durationDays),
      durationDays,
      tripLabel: formatDateRange(startDate, endDate),
    }
  }, [stops])

  // Keep the active bar visible inside the scroll container only
  useEffect(() => {
    const container = scrollRef.current
    if (!container || !currentStopId) return
    if (
      typeof container.scrollTo !== 'function' ||
      typeof window.matchMedia !== 'function'
    ) {
      return
    }

    const bar = Array.from(
      container.querySelectorAll<HTMLElement>('.timeline-stay[data-stop-id]')
    ).find((el) => el.dataset.stopId === currentStopId)
    if (!bar) return

    const barRect = bar.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const fullyVisible =
      barRect.left >= containerRect.left && barRect.right <= containerRect.right
    if (fullyVisible) return

    const barLeftInContent = barRect.left - containerRect.left + container.scrollLeft
    const left = Math.max(
      0,
      barLeftInContent - (containerRect.width - barRect.width) / 2
    )
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches
    container.scrollTo({ left, behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [currentStopId])

  if (!timelineData) {
    return actions ? <div className="trip-timeline-actions">{actions}</div> : null
  }

  const { bars, dateMarkers, durationDays, tripLabel } = timelineData

  const readoutBar =
    bars.find((bar) => bar.id === hoveredId) ??
    bars.find((bar) => bar.id === currentStopId)
  const readout = readoutBar
    ? `${readoutBar.label} · ${readoutBar.dateRange} · ${describeNights(readoutBar.nights)}`
    : `${bars.length} stops · ${tripLabel}`

  return (
    <div className="trip-timeline" role="navigation" aria-label="Trip timeline">
      <div className="timeline-header">
        <div className="timeline-readout">{readout}</div>
        <div className="trip-timeline-actions">{actions}</div>
      </div>
      <div className="timeline-scroll" ref={scrollRef}>
        <div
          className="timeline-inner"
          style={{
            width: `max(100%, calc(${durationDays} * var(--timeline-day-width)))`,
          }}
        >
          <div className="timeline-track">
            {bars.map((bar) => {
              const isActive = currentStopId === bar.id
              return (
                <button
                  key={bar.id}
                  type="button"
                  data-stop-id={bar.id}
                  className={[
                    'timeline-stay',
                    bar.nights === 0 ? 'timeline-stay--pass-through' : '',
                    isActive ? 'timeline-stay--active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{
                    left: `${bar.position}%`,
                    width: `${bar.widthPercent}%`,
                  }}
                  title={bar.label}
                  aria-label={`${bar.label}, ${bar.dateRange}, ${describeNights(bar.nights)}`}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => onStopClick(bar.id)}
                  onMouseEnter={() => setHoveredId(bar.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onFocus={() => setHoveredId(bar.id)}
                  onBlur={() => setHoveredId(null)}
                >
                  <span className="timeline-stay-label">{bar.label}</span>
                  {bar.nights > 0 ? (
                    <span className="timeline-stay-nights">{bar.nights}n</span>
                  ) : null}
                </button>
              )
            })}
          </div>
          <div className="timeline-axis" aria-hidden="true">
            {dateMarkers.map((marker, index) => (
              <div
                key={index}
                className="timeline-marker"
                style={{ left: `${marker.position}%` }}
              >
                <div className="timeline-marker-tick" />
                <div className="timeline-marker-label">{marker.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
