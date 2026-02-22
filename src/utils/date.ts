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
