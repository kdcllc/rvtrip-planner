import type {
  Trip,
  TripStop,
  TripStopSourceName,
  TripStopStatus,
} from '../../domain/trip/types'
import { hashStringFNV1a } from '../../utils/hash'

export const TRIP_FILE_VERSION = 1

const TRIP_STOP_SOURCE_NAMES: TripStopSourceName[] = [
  'RV Life',
  'Hipcamp',
  'Campendium',
  'Harvest Hosts',
  'RV Parky',
  'Other',
]

const TRIP_STOP_STATUSES: TripStopStatus[] = ['idle', 'geocoding', 'ready', 'error']

export type TripFilePayload = {
  version: number
  trip: Trip
  checksum: string
  updatedAt: string
}

export type ParsedTripFilePayload = {
  payload: TripFilePayload
  skippedStops: number
  totalStops: number
}

export function createStopsChecksum(stops: TripStop[]): string {
  const normalizedStops = stops.map((stop) => ({
    id: stop.id,
    label: stop.label,
    address: stop.address,
    startDate: stop.startDate,
    endDate: stop.endDate,
    checkInTime: stop.checkInTime ?? '',
    checkOutTime: stop.checkOutTime ?? '',
    note: stop.note ?? '',
    source: stop.source
      ? {
          name: stop.source.name,
          url: stop.source.url ?? '',
          siteType: stop.source.siteType ?? '',
          fees: stop.source.fees ?? '',
          amenities: stop.source.amenities ?? '',
        }
      : null,
    location: stop.location
      ? { lat: stop.location.lat, lng: stop.location.lng }
      : null,
    status: stop.status ?? 'idle',
    manualEntry: stop.manualEntry ?? false,
    distanceFromPreviousMeters: stop.distanceFromPreviousMeters ?? null,
    estimatedFuelCost: stop.estimatedFuelCost ?? null,
    reservationStatus: stop.reservationStatus ?? '',
    confirmationNumber: stop.confirmationNumber ?? '',
    siteNumber: stop.siteNumber ?? '',
    contactPhone: stop.contactPhone ?? '',
    nightlyCost: stop.nightlyCost ?? null,
    actualGasCost: stop.actualGasCost ?? null,
    actualFoodCost: stop.actualFoodCost ?? null,
    actualMiscCost: stop.actualMiscCost ?? null,
    reservationNote: stop.reservationNote ?? '',
  }))

  return hashStringFNV1a(JSON.stringify(normalizedStops))
}

export function buildTripFilePayload(trip: Trip): TripFilePayload {
  const checksum = createStopsChecksum(trip.stops)
  return {
    version: TRIP_FILE_VERSION,
    trip,
    checksum,
    updatedAt: trip.updatedAt,
  }
}

export function parseTripFilePayload(
  raw: unknown,
  options?: { allowedSourceNames?: Set<TripStopSourceName> },
): ParsedTripFilePayload {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid trip payload')
  }

  const data = raw as Record<string, unknown>
  const version = normalizeVersion(data.version)
  const trip = data.trip

  if (!trip || typeof trip !== 'object') {
    throw new Error('Missing trip data')
  }

  const tripData = trip as Record<string, unknown>
  if (typeof tripData.id !== 'string' || typeof tripData.name !== 'string') {
    throw new Error('Invalid trip data')
  }

  const rawStops = Array.isArray(tripData.stops) ? tripData.stops : null
  if (!rawStops) {
    throw new Error('Invalid trip stops')
  }

  const allowedSourceNames = options?.allowedSourceNames
  const sanitizedStops: TripStop[] = []
  let skippedStops = 0

  for (const stop of rawStops) {
    const sanitized = sanitizeStop(stop, allowedSourceNames)
    if (sanitized) {
      sanitizedStops.push(sanitized)
    } else {
      skippedStops += 1
    }
  }

  const now = new Date().toISOString()
  const createdAt = typeof tripData.createdAt === 'string' ? tripData.createdAt : now
  const updatedAt = typeof tripData.updatedAt === 'string' ? tripData.updatedAt : now
  const vehicleSettings = normalizeVehicleSettings(tripData.vehicleSettings)

  const sanitizedTrip: Trip = {
    id: tripData.id,
    name: tripData.name,
    stops: sanitizedStops,
    createdAt,
    updatedAt,
    vehicleSettings,
  }

  const checksum = createStopsChecksum(sanitizedStops)

  return {
    payload: {
      version,
      trip: sanitizedTrip,
      checksum,
      updatedAt: sanitizedTrip.updatedAt,
    },
    skippedStops,
    totalStops: rawStops.length,
  }
}

export function createTripFileName(trip: Trip): string {
  const name = sanitizeFileName(trip.name)
  return `trip-${name || 'untitled'}-${trip.id}.json`
}

function sanitizeFileName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function sanitizeStop(
  stop: unknown,
  allowedSourceNames?: Set<TripStopSourceName>,
): TripStop | null {
  if (!stop || typeof stop !== 'object') {
    return null
  }

  const stopData = stop as Record<string, unknown>

  if (
    typeof stopData.id !== 'string' ||
    typeof stopData.label !== 'string' ||
    typeof stopData.address !== 'string' ||
    typeof stopData.startDate !== 'string' ||
    typeof stopData.endDate !== 'string'
  ) {
    return null
  }

  const location = stopData.location as { lat?: unknown; lng?: unknown } | undefined
  const lat = location && typeof location.lat === 'number' ? location.lat : undefined
  const lng = location && typeof location.lng === 'number' ? location.lng : undefined
  const hasLocation = typeof lat === 'number' && typeof lng === 'number'
  const note = typeof stopData.note === 'string' ? stopData.note.trim().slice(0, 500) : ''
  const checkInTime =
    typeof stopData.checkInTime === 'string' ? stopData.checkInTime.trim() : ''
  const checkOutTime =
    typeof stopData.checkOutTime === 'string' ? stopData.checkOutTime.trim() : ''

  const rawSource = stopData.source
  const source = rawSource && typeof rawSource === 'object' ? rawSource : null
  const sourceData = source as Record<string, unknown> | null
  const sourceName = sourceData && typeof sourceData.name === 'string' ? sourceData.name : undefined
  const sourceUrl = sourceData && typeof sourceData.url === 'string' ? sourceData.url : undefined
  const sourceSiteType =
    sourceData && typeof sourceData.siteType === 'string' ? sourceData.siteType : undefined
  const sourceFees = sourceData && typeof sourceData.fees === 'string' ? sourceData.fees : undefined
  const sourceAmenities =
    sourceData && typeof sourceData.amenities === 'string' ? sourceData.amenities : undefined
  const normalizedSourceName =
    sourceName && isAllowedSourceName(sourceName, allowedSourceNames) ? sourceName : undefined
  const hasSourceDetails =
    Boolean(normalizedSourceName) ||
    Boolean(sourceUrl) ||
    Boolean(sourceSiteType) ||
    Boolean(sourceFees) ||
    Boolean(sourceAmenities)
  const sanitizedSource = hasSourceDetails
    ? {
        name: (normalizedSourceName ?? 'Other') as TripStopSourceName,
        url: sourceUrl,
        siteType: sourceSiteType,
        fees: sourceFees,
        amenities: sourceAmenities,
      }
    : undefined

  const rawStatus = typeof stopData.status === 'string' ? stopData.status : undefined
  const status = rawStatus && isTripStopStatus(rawStatus) ? rawStatus : 'idle'

  const manualEntry = typeof stopData.manualEntry === 'boolean' ? stopData.manualEntry : undefined
  const distanceFromPreviousMeters =
    typeof stopData.distanceFromPreviousMeters === 'number'
      ? stopData.distanceFromPreviousMeters
      : undefined
  const estimatedFuelCost =
    typeof stopData.estimatedFuelCost === 'number' ? stopData.estimatedFuelCost : undefined

  // Reservation fields
  const reservationStatus = typeof stopData.reservationStatus === 'string' 
    ? (stopData.reservationStatus as 'reserved' | 'unreserved')
    : undefined
  const confirmationNumber = typeof stopData.confirmationNumber === 'string' 
    ? stopData.confirmationNumber.trim().slice(0, 100)
    : undefined
  const siteNumber = typeof stopData.siteNumber === 'string'
    ? stopData.siteNumber.trim().slice(0, 50)
    : undefined
  const contactPhone = typeof stopData.contactPhone === 'string'
    ? stopData.contactPhone.trim().slice(0, 50)
    : undefined
  const nightlyCost = typeof stopData.nightlyCost === 'number' ? stopData.nightlyCost : undefined
  const actualGasCost = typeof stopData.actualGasCost === 'number' ? stopData.actualGasCost : undefined
  const actualFoodCost = typeof stopData.actualFoodCost === 'number' ? stopData.actualFoodCost : undefined
  const actualMiscCost = typeof stopData.actualMiscCost === 'number' ? stopData.actualMiscCost : undefined
  const reservationNote = typeof stopData.reservationNote === 'string'
    ? stopData.reservationNote.trim().slice(0, 200)
    : undefined

  return {
    id: stopData.id,
    label: stopData.label,
    address: stopData.address,
    startDate: stopData.startDate,
    endDate: stopData.endDate,
    checkInTime: checkInTime || undefined,
    checkOutTime: checkOutTime || undefined,
    note: note || undefined,
    source: sanitizedSource,
    location: hasLocation ? { lat, lng } : undefined,
    status,
    manualEntry,
    distanceFromPreviousMeters,
    estimatedFuelCost,
    reservationStatus,
    confirmationNumber,
    siteNumber,
    contactPhone,
    nightlyCost,
    actualGasCost,
    actualFoodCost,
    actualMiscCost,
    reservationNote,
  }
}

function normalizeVersion(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  throw new Error('Invalid trip payload version')
}

function normalizeVehicleSettings(value: unknown): Trip['vehicleSettings'] | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const data = value as Record<string, unknown>
  if (typeof data.mpg !== 'number') {
    return undefined
  }

  return {
    mpg: data.mpg,
  }
}

function isAllowedSourceName(
  value: string,
  allowedSourceNames?: Set<TripStopSourceName>,
): value is TripStopSourceName {
  if (!isTripStopSourceName(value)) {
    return false
  }

  if (!allowedSourceNames) {
    return true
  }

  return allowedSourceNames.has(value)
}

function isTripStopSourceName(value: string): value is TripStopSourceName {
  return TRIP_STOP_SOURCE_NAMES.includes(value as TripStopSourceName)
}

function isTripStopStatus(value: string): value is TripStopStatus {
  return TRIP_STOP_STATUSES.includes(value as TripStopStatus)
}
