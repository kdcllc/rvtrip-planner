import icalGenerator from 'ical-generator'
import type { TripStop } from '../../domain/trip/types'

/**
 * Default check-in time (2:00 PM) for RV parks when no specific time is provided
 */
const DEFAULT_CHECK_IN_TIME = '14:00'

/**
 * Default check-out time (11:00 AM) for RV parks when no specific time is provided
 */
const DEFAULT_CHECK_OUT_TIME = '11:00'

/**
 * Generates an iCalendar (.ics) file content from trip stops
 * 
 * @param stops - Array of trip stops to include in the calendar
 * @param tripName - Name of the trip for the calendar title
 * @returns iCalendar format string that can be saved as .ics file
 */
export function generateICalendar(stops: TripStop[], tripName: string): string {
  const calendar = icalGenerator({ name: tripName })

  for (const stop of stops) {
    // Skip stops without dates
    if (!stop.startDate || !stop.endDate) {
      continue
    }

    // Use provided check-in time or default to 2:00 PM
    const checkInTime = stop.checkInTime || DEFAULT_CHECK_IN_TIME
    // Use provided check-out time or default to 11:00 AM
    const checkOutTime = stop.checkOutTime || DEFAULT_CHECK_OUT_TIME

    // Combine date and time (format: YYYY-MM-DDTHH:mm)
    const startDateTime = `${stop.startDate}T${checkInTime}`
    const endDateTime = `${stop.endDate}T${checkOutTime}`

    // Build event description from available information
    const descriptionParts: string[] = []
    
    if (stop.note) {
      descriptionParts.push(stop.note)
      descriptionParts.push('') // Empty line for separation
    }

    if (stop.source) {
      if (stop.source.name) {
        descriptionParts.push(`Source: ${stop.source.name}`)
      }
      if (stop.source.siteType) {
        descriptionParts.push(`Site Type: ${stop.source.siteType}`)
      }
      if (stop.source.fees) {
        descriptionParts.push(`Fees: ${stop.source.fees}`)
      }
      if (stop.source.amenities) {
        descriptionParts.push(`Amenities: ${stop.source.amenities}`)
      }
    }

    const description = descriptionParts.join('\n')

    // Create calendar event
    calendar.createEvent({
      start: new Date(startDateTime),
      end: new Date(endDateTime),
      summary: stop.label,
      description: description || undefined,
      location: stop.address || undefined,
      url: stop.source?.url || undefined,
    })
  }

  return calendar.toString()
}

/**
 * Downloads an iCalendar file with the given content
 * 
 * @param content - iCalendar format string
 * @param filename - Desired filename (without extension)
 */
export function downloadICalendar(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}.ics`
  
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  
  URL.revokeObjectURL(url)
}
