import type { Trip, TripStop } from '../../domain/trip/types'
import { hashStringFNV1a } from '../../utils/hash'

export const DRIVE_TRIP_VERSION = 1

export type DriveTripPayload = {
  version: number
  trip: Trip
  checksum: string
  updatedAt: string
}

export type DriveTripAppProperties = {
  tripId: string
  tripName: string
  updatedAt: string
  checksum: string
  version: string
}

export type DriveTripFileInfo = {
  id: string
  name: string
  modifiedTime?: string
  appProperties?: DriveTripAppProperties
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
  }))

  return hashStringFNV1a(JSON.stringify(normalizedStops))
}

export function buildDriveTripPayload(trip: Trip): DriveTripPayload {
  const checksum = createStopsChecksum(trip.stops)
  return {
    version: DRIVE_TRIP_VERSION,
    trip,
    checksum,
    updatedAt: trip.updatedAt,
  }
}

export function buildDriveAppProperties(
  trip: Trip,
  checksum: string,
): DriveTripAppProperties {
  return {
    tripId: trip.id,
    tripName: trip.name,
    updatedAt: trip.updatedAt,
    checksum,
    version: String(DRIVE_TRIP_VERSION),
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
