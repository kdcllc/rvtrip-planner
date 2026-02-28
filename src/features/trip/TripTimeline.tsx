import { useMemo, useRef, useEffect, forwardRef } from 'react'
import type { TripStop } from '../../domain/trip/types'
import {
  getTripDateRange,
  getDaysBetweenStops,
  getDateMarkersForRange,
  getStopDatePosition,
  formatDateRange,
} from '../../utils/date'
import './TripTimeline.css'

type TripTimelineProps = {
  stops: TripStop[]
  onStopClick: (stopId: string) => void
  currentStopId: string | null
  carouselRef?: React.RefObject<HTMLDivElement | null>
}

export const TripTimeline = forwardRef<HTMLDivElement, TripTimelineProps>(
  ({ stops, onStopClick, currentStopId, carouselRef }, ref) => {
  const timelineRef = useRef<HTMLDivElement>(null)
  
  // Sync timeline scroll with carousel scroll - match scroll positions directly
  useEffect(() => {
    if (!carouselRef?.current || !timelineRef.current) return

    const carousel = carouselRef.current
    const timeline = timelineRef.current

    const handleCarouselScroll = () => {
      // Map carousel scroll to timeline scroll maintaining proportional position
      const carouselScrollLeft = carousel.scrollLeft
      const carouselScrollWidth = carousel.scrollWidth
      const carouselClientWidth = carousel.clientWidth
      
      const timelineScrollWidth = timeline.scrollWidth
      const timelineClientWidth = timeline.clientWidth
      
      // Calculate the proportion of how far carousel has scrolled
      const carouselScrollRatio = 
        carouselScrollWidth > carouselClientWidth
          ? carouselScrollLeft / (carouselScrollWidth - carouselClientWidth)
          : 0
      
      // Apply the same scroll ratio to timeline
      const maxTimelineScroll = Math.max(0, timelineScrollWidth - timelineClientWidth)
      timeline.scrollLeft = carouselScrollRatio * maxTimelineScroll
    }

    // Add scroll listener
    carousel.addEventListener('scroll', handleCarouselScroll)
    return () => carousel.removeEventListener('scroll', handleCarouselScroll)
  }, [stops.length])
  // Calculate timeline data
  const timelineData = useMemo(() => {
    // Need at least 2 stops for a meaningful timeline
    if (stops.length < 2) {
      return null
    }

    const tripRange = getTripDateRange(stops)
    if (!tripRange) {
      return null
    }

    const { startDate, endDate, durationDays } = tripRange

    // Position stops chronologically based on their actual dates
    // Stops are positioned proportionally across the timeline according to trip duration
    const validStops = stops.filter((stop) => stop.startDate && stop.endDate)
    const stopCount = validStops.length
    
    // Calculate proportional positions (0-100%) based on stop dates
    // Handles overlapping starts by offsetting stops that begin on the same date
    const stopPositions = validStops.map((stop, index) => {
      // Position stops based on their actual chronological position in the trip
      let position = getStopDatePosition(stop.startDate, startDate, durationDays)
      
      // If multiple stops start on the same date, offset them slightly to prevent overlap
      // Check previous stops for same start date
      for (let i = 0; i < index; i++) {
        if (validStops[i].startDate === stop.startDate) {
          // Offset by 2% per overlapping stop to separate them visually
          position += 2
        }
      }
      
      // Calculate duration in nights for this stop (check-in to check-out)
      // 0 nights = pass-through stop (same day arrival and departure)
      const start = new Date(`${stop.startDate}T00:00:00`)
      const end = new Date(`${stop.endDate}T00:00:00`)
      const durationNights = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
      
      // Calculate the visual width as a percentage of the timeline to match the date span
      // This ensures the segment visually covers the actual dates it represents
      const widthPercent = durationNights > 0 ? (durationNights / durationDays) * 100 : 0
      
      return {
        id: stop.id,
        label: stop.label,
        dateRange: formatDateRange(stop.startDate, stop.endDate),
        position: Math.min(position, 100), // Cap at 100%
        index,
        durationNights,
        widthPercent, // Width as percentage of timeline
      }
    })

    // Calculate gaps between consecutive stops (optional visual)
    const gaps = []
    for (let i = 0; i < validStops.length - 1; i++) {
      const currentStop = validStops[i]
      const nextStop = validStops[i + 1]
      if (currentStop.endDate && nextStop.startDate) {
        const gapDays = getDaysBetweenStops(
          currentStop.endDate,
          nextStop.startDate
        )
        if (gapDays > 0) {
          // Position gaps based on proportional layout
          const startPosition = ((i + 1) / stopCount) * 100
          const endPosition = ((i + 1.5) / stopCount) * 100
          gaps.push({
            startPosition,
            endPosition,
            days: gapDays,
          })
        }
      }
    }

    // Get date markers for the timeline (shows actual chronological dates)
    // Pass durationDays to ensure consistency with stop position calculations
    const dateMarkers = getDateMarkersForRange(startDate, endDate, durationDays)

    return {
      stopPositions,
      gaps,
      dateMarkers,
      durationDays,
    }
  }, [stops])

  // Don't render if we don't have enough data
  if (!timelineData || timelineData.stopPositions.length < 2) {
    return null
  }

  const { stopPositions, gaps, dateMarkers, durationDays } = timelineData

  return (
    <div 
      ref={timelineRef || ref}
      className="trip-timeline" 
      role="navigation" 
      aria-label="Trip timeline"
    >
      {/* Inner wrapper for scrollable content */}
      <div className="timeline-inner" style={{ 
        // Timeline width scales with trip duration to provide adequate scroll space
        // Width = durationDays * TIMELINE_WIDTH_PER_DAY%
        // Min 120% ensures short trips are still scrollable/readable
        // 15% per day provides good visual spacing (e.g., 10 days = 150%, 20 days = 300%)
        width: `${Math.max(120, durationDays * 15)}%`,
      }}>
      {/* Date markers */}
      <div className="timeline-markers">
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

      {/* Timeline bar */}
      <div className="timeline-bar">
        {/* Gap indicators (dashed segments) */}
        {gaps.map((gap, index) => (
          <div
            key={index}
            className="timeline-gap"
            style={{
              left: `${gap.startPosition}%`,
              width: `${gap.endPosition - gap.startPosition}%`,
            }}
            title={`${gap.days} day${gap.days === 1 ? '' : 's'} gap`}
          />
        ))}

        {/* Stop indicators */}
        {stopPositions.map((stop) => (
          <button
            key={stop.id}
            className={`timeline-stop ${
              currentStopId === stop.id ? 'timeline-stop--active' : ''
            }`}
            style={{ left: `${stop.position}%` }}
            onClick={() => onStopClick(stop.id)}
            title={`${stop.label} • ${stop.dateRange} • ${stop.durationNights === 0 ? 'pass through' : `${stop.durationNights} night${stop.durationNights === 1 ? '' : 's'}`}`}
            aria-label={`Navigate to ${stop.label}`}
          >
            <div 
              className="timeline-stop-segment" 
              data-duration={stop.durationNights}
              style={{ width: stop.widthPercent > 0 ? `${stop.widthPercent}%` : '24px' }}
            >
              <div className="timeline-stop-duration-label">
                {stop.durationNights === 0 ? '—' : `${stop.durationNights}n`}
              </div>
            </div>
            <div className="timeline-stop-tooltip">
              <div className="timeline-stop-tooltip-label">{stop.label}</div>
              <div className="timeline-stop-tooltip-dates">{stop.dateRange}</div>
              <div className="timeline-stop-tooltip-duration">
                {stop.durationNights === 0 ? 'Pass through' : `${stop.durationNights} night${stop.durationNights === 1 ? '' : 's'}`}
              </div>
            </div>
          </button>
        ))}
      </div>
      </div>
    </div>
  )
})

TripTimeline.displayName = 'TripTimeline'
