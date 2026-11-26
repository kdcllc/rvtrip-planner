import type { TripStop, TripStopSourceName } from './types'

export const STOP_NOTE_MAX_LENGTH = 2000

/** A stop as persisted before the form merge: may still carry the three legacy text fields. */
export type LegacyTripStop = Omit<TripStop, 'source' | 'reservationNote'> & {
  reservationNote?: string
  source?: {
    name: TripStopSourceName
    url?: string
    siteType?: string
    fees?: string
    amenities?: string
  }
}

const PRICE_ONLY = /^\$?\s*(\d+(?:\.\d+)?)(?:\s*(?:\/|per)\s*night)?$/i

const hasText = (v: string | undefined): v is string =>
  typeof v === 'string' && v.trim() !== ''

export function foldLegacyStopFields(stop: LegacyTripStop): TripStop {
  const { reservationNote, source, ...rest } = stop
  const hasLegacy =
    'reservationNote' in stop ||
    (source !== undefined && ('fees' in source || 'amenities' in source))
  if (!hasLegacy) return stop as TripStop

  const lines: string[] = []
  let nightlyCost = rest.nightlyCost

  if (hasText(source?.fees)) {
    const fees = source.fees.trim()
    const match = PRICE_ONLY.exec(fees)
    if (match && nightlyCost === undefined) nightlyCost = Number(match[1])
    else lines.push(`Fees: ${fees}`)
  }
  if (hasText(source?.amenities)) {
    lines.push(`Amenities: ${source.amenities.trim()}`)
  }
  if (hasText(reservationNote)) {
    lines.push(`Reservation: ${reservationNote.trim()}`)
  }

  const result: TripStop = { ...rest }
  if (nightlyCost !== undefined) result.nightlyCost = nightlyCost
  if (lines.length > 0) {
    result.note = hasText(rest.note)
      ? [rest.note, ...lines].join('\n')
      : lines.join('\n')
  }
  if (source) {
    const keptSource = { ...source }
    delete keptSource.fees
    delete keptSource.amenities
    result.source = keptSource
  }
  return result
}

export function deriveStopLabel(address: string): string {
  const trimmed = address.trim()
  const comma = trimmed.indexOf(',')
  return (comma === -1 ? trimmed : trimmed.slice(0, comma)).trim()
}

export function hasStopDates(
  stop: Pick<TripStop, 'startDate' | 'endDate'>,
): boolean {
  return (
    typeof stop.startDate === 'string' &&
    stop.startDate !== '' &&
    typeof stop.endDate === 'string' &&
    stop.endDate !== ''
  )
}
