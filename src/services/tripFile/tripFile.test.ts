import { describe, expect, it } from 'vitest'
import type { Trip } from '../../domain/trip/types'
import legacyFixture from './__fixtures__/legacy-trip-payload-v1.json'
import {
  TRIP_FILE_VERSION,
  buildTripFilePayload,
  buildTripsBackupPayload,
  createBackupFileName,
  createStopsChecksum,
  createTripFileName,
  parseImportFile,
  parseTripFilePayload,
} from './tripFile'

const trip: Trip = {
  id: 'trip-1',
  name: 'Summer Loop!',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
  vehicleSettings: { mpg: 10 },
  stops: [
    {
      id: 's1',
      label: 'A',
      address: 'Moab, UT',
      startDate: '2024-06-01',
      endDate: '2024-06-02',
      note: 'hi',
      location: { lat: 1, lng: 2 },
      status: 'ready',
    },
    { id: 's2', label: 'B', address: 'Page, AZ', startDate: '2024-06-02', endDate: '2024-06-03' },
  ],
}

describe('tripFile', () => {
  it('round-trips a payload through JSON', () => {
    const result = parseTripFilePayload(JSON.parse(JSON.stringify(buildTripFilePayload(trip))))
    expect(result.skippedStops).toBe(0)
    expect(result.totalStops).toBe(2)
    expect(result.payload.trip.id).toBe(trip.id)
    expect(result.payload.trip.name).toBe(trip.name)
    expect(result.payload.trip.stops.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(result.payload.trip.stops[0].location).toEqual({ lat: 1, lng: 2 })
    expect(result.payload.trip.vehicleSettings).toEqual({ mpg: 10 })
  })

  it('parses the legacy v1 fixture', () => {
    const { payload, skippedStops, totalStops } = parseTripFilePayload(legacyFixture)
    expect(payload.version).toBe(1)
    expect(TRIP_FILE_VERSION).toBe(1)
    expect(skippedStops).toBe(0)
    expect(totalStops).toBe(legacyFixture.trip.stops.length)
    expect(payload.trip.id).toBe(legacyFixture.trip.id)
    expect(payload.trip.stops[0].confirmationNumber).toBe('ABC123')
    expect(payload.checksum).toBe(createStopsChecksum(payload.trip.stops))
    for (const stop of payload.trip.stops) {
      expect(stop).not.toHaveProperty('reservationNote')
      expect(stop.source ?? {}).not.toHaveProperty('fees')
      expect(stop.source ?? {}).not.toHaveProperty('amenities')
    }
    const first = payload.trip.stops[0]
    expect(first.nightlyCost).toBe(45)
    expect(first.note).toContain('Amenities: Wifi')
    expect(first.note).toContain('Reservation: Pull-through')
  })

  it('exports no legacy keys and round-trips merged stops', () => {
    const legacyTrip = {
      ...trip,
      stops: [
        {
          ...trip.stops[0],
          reservationNote: 'Late arrival',
          source: { name: 'Hipcamp', fees: 'Dog fee $10', amenities: 'Pool' },
        },
        trip.stops[1],
      ],
    } as Trip
    const json = JSON.stringify(buildTripFilePayload(legacyTrip))
    expect(json).not.toMatch(/"(fees|amenities|reservationNote)"/)
    const merged = buildTripFilePayload(trip)
    const parsed = parseTripFilePayload(JSON.parse(JSON.stringify(merged)))
    expect(parsed.payload.trip.stops).toEqual(
      merged.trip.stops.map((stop) => ({ ...stop, status: stop.status ?? 'idle' })),
    )
    expect(parsed.payload.checksum).toBe(merged.checksum)
  })

  it('imports a legacy file whose stored checksum differs', () => {
    const raw = JSON.parse(JSON.stringify(legacyFixture))
    raw.checksum = 'stale'
    expect(() => parseTripFilePayload(raw)).not.toThrow()
  })

  it('keeps long notes up to the shared limit and accepts undated stops', () => {
    const raw = {
      version: 1,
      trip: {
        id: 't',
        name: 'n',
        stops: [{ id: 'u', label: 'U', address: 'X', startDate: '', endDate: '', note: 'a'.repeat(1500) }],
      },
    }
    const { payload, skippedStops } = parseTripFilePayload(raw)
    expect(skippedStops).toBe(0)
    expect(payload.trip.stops[0].note).toHaveLength(1500)
    expect(payload.trip.stops[0].startDate).toBe('')
  })

  it('builds a stable file name', () => {
    expect(createTripFileName(trip)).toBe('trip-summer-loop-trip-1.json')
    expect(createTripFileName({ ...trip, name: '!!!' })).toBe('trip-untitled-trip-1.json')
  })

  it('rejects malformed payloads and skips bad stops', () => {
    expect(() => parseTripFilePayload(null)).toThrow()
    const raw = JSON.parse(JSON.stringify(buildTripFilePayload(trip)))
    raw.trip.stops.push({ id: 5 })
    expect(parseTripFilePayload(raw).skippedStops).toBe(1)
  })
})

describe('trips backup', () => {
  const trip2: Trip = { ...trip, id: 'trip-2', name: 'Second' }

  it('round-trips a backup of two trips', () => {
    const backup = buildTripsBackupPayload([trip, trip2], new Date('2024-03-04T05:06:07.000Z'))
    expect(backup.kind).toBe('rv-trip-planner-backup')
    expect(backup.version).toBe(1)
    expect(backup.exportedAt).toBe('2024-03-04T05:06:07.000Z')
    const result = parseImportFile(JSON.parse(JSON.stringify(backup)))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.trips.map((t) => t.id)).toEqual(['trip-1', 'trip-2'])
  })

  it('still parses a single-trip file', () => {
    const result = parseImportFile(JSON.parse(JSON.stringify(buildTripFilePayload(trip))))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.trips.map((t) => t.id)).toEqual(['trip-1'])
  })

  it('rejects the whole backup naming the invalid entry index', () => {
    const backup = JSON.parse(JSON.stringify(buildTripsBackupPayload([trip, trip2])))
    backup.trips[1].trip = null
    const result = parseImportFile(backup)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('index 1')
  })

  it('rejects an empty backup', () => {
    const result = parseImportFile(buildTripsBackupPayload([]))
    expect(result.ok).toBe(false)
  })

  it('formats the backup file name', () => {
    expect(createBackupFileName(new Date('2024-03-04T12:00:00.000Z'))).toBe(
      'rv-trips-backup-2024-03-04.json',
    )
  })
})
