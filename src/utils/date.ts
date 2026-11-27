import type { TripStop } from '../domain/trip/types'

export const formatDateRange = (startDate: string, endDate: string) => {
  if (!startDate || !endDate) {
    return 'Dates not set'
  }

  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)

  return `${start.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })} - ${end.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })}`
}

export const formatDate = (date: string) => {
  const normalized = new Date(`${date}T00:00:00`)
  return normalized.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Formats a date range with day-of-week for each date
 * For single-day ranges (startDate === endDate), returns only the single date with day-of-week
 * For multi-day ranges, returns "Weekday, Mon Day - Weekday, Mon Day" format
 * @param startDate - Start date in YYYY-MM-DD format
 * @param endDate - End date in YYYY-MM-DD format
 * @returns Formatted date range with day-of-week (e.g., "Sat, Mar 15 - Sun, Mar 17" or "Sat, Mar 15")
 */
export const formatDateRangeWithDays = (startDate: string, endDate: string) => {
  if (!startDate || !endDate) {
    return 'Dates not set'
  }

  const start = formatDate(startDate)
  const end = formatDate(endDate)

  // For single-day stays, return just one date
  if (startDate === endDate) {
    return start
  }

  return `${start} - ${end}`
}

/**
 * Formats a 24-hour time string (HH:mm) to 12-hour format with AM/PM
 * @param timeString - Time in 24-hour format (e.g., "14:00")
 * @returns Time in 12-hour format with AM/PM (e.g., "2:00 PM")
 */
export const formatTime = (timeString: string): string => {
  if (!timeString) {
    return ''
  }

  const [hoursStr, minutesStr] = timeString.split(':')
  const hours = parseInt(hoursStr, 10)
  const minutes = parseInt(minutesStr, 10)

  if (isNaN(hours) || isNaN(minutes)) {
    return timeString
  }

  const period = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
  const displayMinutes = minutes.toString().padStart(2, '0')

  return `${displayHours}:${displayMinutes} ${period}`
}

/**
 * Timeline utilities for visualizing trip duration and stop positions
 */

export type TripDateRange = {
  startDate: string
  endDate: string
  durationDays: number
}

export type DateMarker = {
  date: string
  label: string
  position: number
}

/**
 * Get the overall date range for a trip based on its stops
 * @param stops - Array of trip stops with startDate and endDate
 * @returns Trip date range with start, end, and duration in days
 */
export const getTripDateRange = (
  stops: Array<{ startDate: string; endDate: string }>
): TripDateRange | null => {
  const validStops = stops.filter((stop) => stop.startDate && stop.endDate)
  if (validStops.length === 0) {
    return null
  }

  const dates = validStops.flatMap((stop) => [stop.startDate, stop.endDate])
  const sortedDates = dates.sort()
  const startDate = sortedDates[0]
  const endDate = sortedDates[sortedDates.length - 1]

  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  const durationDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))

  return {
    startDate,
    endDate,
    durationDays,
  }
}

/**
 * Calculate the position percentage (0-100) of a stop on the timeline
 * @param stopStartDate - The start date of the stop (YYYY-MM-DD)
 * @param tripStartDate - The start date of the entire trip (YYYY-MM-DD)
 * @param tripDurationDays - Total duration of the trip in days
 * @returns Position percentage (0-100)
 */
export const getStopDatePosition = (
  stopStartDate: string,
  tripStartDate: string,
  tripDurationDays: number
): number => {
  if (!stopStartDate || !tripStartDate || tripDurationDays <= 0) {
    return 0
  }

  const stop = new Date(`${stopStartDate}T00:00:00`)
  const tripStart = new Date(`${tripStartDate}T00:00:00`)
  // Normalize to integer day boundaries to align with date markers
  const daysFromStart = Math.round((stop.getTime() - tripStart.getTime()) / (1000 * 60 * 60 * 24))

  return Math.max(0, Math.min(100, (daysFromStart / tripDurationDays) * 100))
}

/**
 * Calculate the number of days between two stops (gap days)
 * @param stop1EndDate - End date of first stop (YYYY-MM-DD)
 * @param stop2StartDate - Start date of second stop (YYYY-MM-DD)
 * @returns Number of gap days (0 or positive integer)
 */
export const getDaysBetweenStops = (
  stop1EndDate: string,
  stop2StartDate: string
): number => {
  if (!stop1EndDate || !stop2StartDate) {
    return 0
  }

  const end1 = new Date(`${stop1EndDate}T00:00:00`)
  const start2 = new Date(`${stop2StartDate}T00:00:00`)
  const gapMs = start2.getTime() - end1.getTime()
  const gapDays = Math.round(gapMs / (1000 * 60 * 60 * 24))

  return Math.max(0, gapDays)
}

/**
 * Generate date markers for the timeline based on trip duration
 * @param startDate - Trip start date (YYYY-MM-DD)
 * @param endDate - Trip end date (YYYY-MM-DD)
 * @param knownDurationDays - Optional pre-calculated duration to ensure consistency
 * @returns Array of date markers with labels and positions
 */
export const getDateMarkersForRange = (
  startDate: string,
  endDate: string,
  knownDurationDays?: number
): DateMarker[] => {
  if (!startDate || !endDate) {
    return []
  }

  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  const durationMs = end.getTime() - start.getTime()
  // Use pre-calculated durationDays if provided to ensure consistency with stop positions
  const durationDays = knownDurationDays ?? Math.round(durationMs / (1000 * 60 * 60 * 24))

  if (durationDays <= 0) {
    return []
  }

  const markers: DateMarker[] = []

  // Show actual calendar dates
  // Determine marker interval based on trip length
  let intervalDays: number
  if (durationDays <= 14) {
    intervalDays = 1 // Show every day for trips up to 2 weeks (better alignment visibility)
  } else if (durationDays <= 30) {
    intervalDays = 3 // Show every 3 days for longer trips
  } else {
    intervalDays = 7 // Show weekly for very long trips
  }

  // Always add first date
  markers.push({
    date: startDate,
    label: new Date(`${startDate}T00:00:00`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    }),
    position: 0,
  })

  // Add intermediate date markers
  for (let i = intervalDays; i < durationDays; i += intervalDays) {
    const markerDate = new Date(start.getTime() + i * 24 * 60 * 60 * 1000)
    const dateStr = markerDate.toISOString().split('T')[0]
    markers.push({
      date: dateStr,
      label: markerDate.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      position: (i / durationDays) * 100,
    })
  }

  // Always add last date (if not too close to the last marker)
  const lastMarkerPosition = markers[markers.length - 1].position
  if (100 - lastMarkerPosition > 5) {
    // Only add if > 5% away from last marker
    markers.push({
      date: endDate,
      label: new Date(`${endDate}T00:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      position: 100,
    })
  } else {
    // Replace last marker with end date
    markers[markers.length - 1] = {
      date: endDate,
      label: new Date(`${endDate}T00:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      position: 100,
    }
  }

  return markers
}

const padDatePart = (value: number) => value.toString().padStart(2, '0')

const toLocalDateKey = (referenceDate: Date) => {
  return `${referenceDate.getFullYear()}-${padDatePart(referenceDate.getMonth() + 1)}-${padDatePart(referenceDate.getDate())}`
}

const compareTripStopDates = (left: TripStop, right: TripStop) => {
  const startDateComparison = left.startDate.localeCompare(right.startDate)
  if (startDateComparison !== 0) {
    return startDateComparison
  }

  return left.endDate.localeCompare(right.endDate)
}

const isDatedStop = (stop: TripStop) => Boolean(stop.startDate && stop.endDate)

export const getRelevantStopForDate = (
  stops: TripStop[],
  referenceDate: Date = new Date()
): TripStop | null => {
  const datedStops = stops.filter(isDatedStop).slice().sort(compareTripStopDates)
  if (datedStops.length === 0) {
    return null
  }

  const referenceDateKey = toLocalDateKey(referenceDate)

  const currentStop = datedStops.find(
    (stop: TripStop) => stop.startDate <= referenceDateKey && stop.endDate >= referenceDateKey
  )
  if (currentStop) {
    return currentStop
  }

  const upcomingStop = datedStops.find((stop: TripStop) => stop.startDate > referenceDateKey)
  if (upcomingStop) {
    return upcomingStop
  }

  return datedStops[datedStops.length - 1]
}

export const getRelevantStopIdForDate = (
  stops: TripStop[],
  referenceDate: Date = new Date()
) => {
  return getRelevantStopForDate(stops, referenceDate)?.id ?? null
}
