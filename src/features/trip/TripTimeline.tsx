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
  onStopPreview?: (stopId: string | null) => void
  onStopDetails?: (stopId: string) => void
}

const MS_PER_DAY = 1000 * 60 * 60 * 24
// 44px minimum pass-through width at the 72px narrow day width, rounded up
const MIN_PASS_THROUGH_DAYS = 0.65

const describeNights = (nights: number) =>
  nights === 0
    ? 'pass-through stop'
    : `${nights} night${nights === 1 ? '' : 's'}`

export function TripTimeline({
  stops,
  onStopClick,
  currentStopId,
  actions,
  onStopPreview,
  onStopDetails,
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

    const rawBars = validStops.map((stop) => {
      const position = getStopDatePosition(stop.startDate, startDate, durationDays)

      const start = new Date(`${stop.startDate}T00:00:00`)
      const end = new Date(`${stop.endDate}T00:00:00`)
      const nights = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY)
      const widthPercent = nights > 0 ? (nights / durationDays) * 100 : 0
      const spanStart = Math.round((position / 100) * durationDays)

      return {
        id: stop.id,
        label: stop.label,
        dateRange: formatDateRange(stop.startDate, stop.endDate),
        position,
        nights,
        widthPercent,
        spanStart,
        spanEnd: spanStart + (nights > 0 ? nights : MIN_PASS_THROUGH_DAYS),
      }
    })

    // Greedy lane assignment: stays first, then pass-through stops
    const lanes: Array<Array<{ spanStart: number; spanEnd: number }>> = []
    const laneById = new Map<string, number>()
    const order = rawBars
      .map((bar, index) => ({ bar, index }))
      .sort((a, b) => {
        const aPass = a.bar.nights === 0 ? 1 : 0
        const bPass = b.bar.nights === 0 ? 1 : 0
        return (
          aPass - bPass || a.bar.spanStart - b.bar.spanStart || a.index - b.index
        )
      })
    for (const { bar } of order) {
      let lane = lanes.findIndex((placed) =>
        placed.every(
          (other) => bar.spanEnd <= other.spanStart || other.spanEnd <= bar.spanStart
        )
      )
      if (lane === -1) {
        lane = lanes.length
        lanes.push([])
      }
      lanes[lane].push(bar)
      laneById.set(bar.id, lane)
    }

    const bars = rawBars.map((bar) => ({ ...bar, lane: laneById.get(bar.id) ?? 0 }))

    return {
      bars,
      laneCount: Math.max(1, lanes.length),
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

  const { bars, laneCount, dateMarkers, durationDays, tripLabel } = timelineData

  const readoutBar =
    bars.find((bar) => bar.id === hoveredId) ??
    bars.find((bar) => bar.id === currentStopId)
  const currentBar = bars.find((bar) => bar.id === currentStopId)
  const readout = readoutBar
    ? `${readoutBar.label} · ${readoutBar.dateRange} · ${describeNights(readoutBar.nights)}`
    : `${bars.length} stops · ${tripLabel}`

  return (
    <div className="trip-timeline" role="navigation" aria-label="Trip timeline">
      <div className="timeline-header">
        <div className="timeline-readout">{readout}</div>
        {onStopDetails && currentBar ? (
          <button
            type="button"
            className="timeline-details-button"
            aria-label={`Show details for ${currentBar.label}`}
            onClick={() => onStopDetails(currentBar.id)}
          >
            Details
          </button>
        ) : null}
        <div className="trip-timeline-actions">{actions}</div>
      </div>
      <div className="timeline-scroll" ref={scrollRef}>
        <div
          className="timeline-inner"
          style={{
            width: `max(100%, calc(${durationDays} * var(--timeline-day-width)))`,
          }}
        >
          <div
            className="timeline-track"
            style={{ '--timeline-lanes': laneCount } as React.CSSProperties}
          >
            {bars.map((bar) => {
              const isActive = currentStopId === bar.id
              return (
                <button
                  key={bar.id}
                  type="button"
                  data-stop-id={bar.id}
                  data-lane={bar.lane}
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
                    '--timeline-lane': bar.lane,
                  } as React.CSSProperties}
                  title={bar.label}
                  aria-label={`${bar.label}, ${bar.dateRange}, ${describeNights(bar.nights)}`}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => onStopClick(bar.id)}
                  onDoubleClick={
                    onStopDetails ? () => onStopDetails(bar.id) : undefined
                  }
                  onMouseEnter={() => {
                    setHoveredId(bar.id)
                    onStopPreview?.(bar.id)
                  }}
                  onMouseLeave={() => {
                    setHoveredId(null)
                    onStopPreview?.(null)
                  }}
                  onFocus={() => {
                    setHoveredId(bar.id)
                    onStopPreview?.(bar.id)
                  }}
                  onBlur={() => {
                    setHoveredId(null)
                    onStopPreview?.(null)
                  }}
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
