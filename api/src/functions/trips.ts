// Per-trip API over dbo.user_trips (one row per trip, JSON in `data`, integer `version`).
// user_id comes ONLY from the validated session. No retry/sleep on 40613: the shared 503 path.
//   GET    /api/trips              all of the caller's trips + current trip id
//   PUT    /api/trips/{tripId}     create (baseVersion null) or update (optimistic concurrency)
//   DELETE /api/trips/{tripId}     idempotent delete
//   POST   /api/trips/import       bulk insert-if-absent
//   PUT    /api/trip-selection     set users.current_trip_id
// dbo.trips (legacy blob) is never read or written here.
import { app } from '@azure/functions'
import type { HttpRequest, HttpResponseInit } from '@azure/functions'
import { query, sql } from '../shared/db'
import { csrfGuard, error, fromException, json } from '../shared/http'
import { validateSession } from '../shared/session'
import type {
  DeleteTripResponse,
  GetTripsResponse,
  ImportTripsResponse,
  PutTripResponse,
  PutTripSelectionResponse,
  Trip,
  TripConflictResponse,
  VersionedTrip,
} from '../shared/types'

/** SWA request ceiling is 30 MB. */
export const MAX_BODY_BYTES = 30 * 1024 * 1024
export const MAX_ID_LENGTH = 128
export const MAX_IMPORT_TRIPS = 200

const SQL_DUPLICATE_KEY = [2627, 2601]

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isStop(v: unknown): boolean {
  return isObject(v) && typeof v.id === 'string' && typeof v.label === 'string'
}

function isTrip(v: unknown): v is Trip {
  return (
    isObject(v) &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    Array.isArray(v.stops) &&
    v.stops.every(isStop) &&
    typeof v.createdAt === 'string' &&
    typeof v.updatedAt === 'string'
  )
}

/** Re-serialise from the known top-level Trip fields only: unknown keys never reach the DB. */
function sanitizeTrip(t: Trip): Trip {
  const out: Trip = { id: t.id, name: t.name, stops: t.stops, createdAt: t.createdAt, updatedAt: t.updatedAt }
  if (t.vehicleSettings !== undefined) out.vehicleSettings = t.vehicleSettings
  return out
}

function validId(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 1 && v.length <= MAX_ID_LENGTH
}

function isDuplicateKey(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { number?: unknown; originalError?: { number?: unknown } }
  return [e.number, e.originalError?.number].some((n) => typeof n === 'number' && SQL_DUPLICATE_KEY.includes(n))
}

function parseRow(data: string, version: number): VersionedTrip | null {
  try {
    const parsed: unknown = JSON.parse(data)
    return isTrip(parsed) ? { trip: parsed, version } : null
  } catch {
    return null
  }
}

type ReadBody = { ok: true; body: unknown } | { ok: false; res: HttpResponseInit }

async function readBody(req: HttpRequest): Promise<ReadBody> {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, res: error(413, 'Payload too large', 'PAYLOAD_TOO_LARGE') }
  }
  let text: string
  try {
    text = await req.text()
  } catch {
    return { ok: false, res: error(400, 'Invalid request body') }
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    return { ok: false, res: error(413, 'Payload too large', 'PAYLOAD_TOO_LARGE') }
  }
  try {
    return { ok: true, body: JSON.parse(text) }
  } catch {
    return { ok: false, res: error(400, 'Invalid request body') }
  }
}

async function currentRow(userId: string, tripId: string): Promise<VersionedTrip | null> {
  const r = await query<{ data: string; version: number }>(
    'SELECT data, version FROM dbo.user_trips WHERE user_id = @userId AND trip_id = @tripId',
    { userId: { type: sql.UniqueIdentifier, value: userId }, tripId: { type: sql.NVarChar(MAX_ID_LENGTH), value: tripId } },
  )
  const row = r.recordset[0]
  return row ? parseRow(row.data, row.version) : null
}

async function conflict(userId: string, tripId: string): Promise<HttpResponseInit> {
  const current = await currentRow(userId, tripId)
  const body: TripConflictResponse = { error: 'Version conflict', code: 'VERSION_CONFLICT', current }
  return { status: 409, jsonBody: body }
}

export async function getTrips(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const user = await validateSession(req)
    if (!user) return error(401, 'Unauthorized')
    const userParam = { userId: { type: sql.UniqueIdentifier, value: user.id } }
    const rows = await query<{ trip_id: string; data: string; version: number }>(
      'SELECT trip_id, data, version FROM dbo.user_trips WHERE user_id = @userId ORDER BY updated_at DESC',
      userParam,
    )
    const trips: VersionedTrip[] = []
    for (const row of rows.recordset) {
      const parsed = parseRow(row.data, row.version)
      if (parsed) trips.push(parsed)
    }
    const cur = await query<{ current_trip_id: string | null }>(
      'SELECT current_trip_id FROM dbo.users WHERE id = @userId',
      userParam,
    )
    const id = cur.recordset[0]?.current_trip_id ?? null
    const currentTripId = id !== null && trips.some((t) => t.trip.id === id) ? id : null
    return json<GetTripsResponse>({ trips, currentTripId })
  } catch (err) {
    return fromException(err)
  }
}

export async function putTrip(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const blocked = csrfGuard(req)
    if (blocked) return blocked
    const user = await validateSession(req)
    if (!user) return error(401, 'Unauthorized')
    const tripId = req.params?.tripId
    if (!validId(tripId)) return error(400, 'Invalid trip id')
    const read = await readBody(req)
    if (!read.ok) return read.res
    const body = read.body
    if (!isObject(body) || !isTrip(body.trip) || body.trip.id !== tripId) return error(400, 'Invalid trip payload')
    const baseVersion = body.baseVersion
    if (baseVersion !== null && !(typeof baseVersion === 'number' && Number.isInteger(baseVersion) && baseVersion >= 1)) {
      return error(400, 'Invalid trip payload')
    }
    const params = {
      userId: { type: sql.UniqueIdentifier, value: user.id },
      tripId: { type: sql.NVarChar(MAX_ID_LENGTH), value: tripId },
      data: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(sanitizeTrip(body.trip)) },
    }

    if (baseVersion === null) {
      try {
        await query(
          'INSERT INTO dbo.user_trips (user_id, trip_id, data) VALUES (@userId, @tripId, @data)',
          params,
        )
      } catch (err) {
        if (isDuplicateKey(err)) return await conflict(user.id, tripId)
        throw err
      }
      return json<PutTripResponse>({ version: 1 })
    }

    // Single atomic conditional UPDATE: no read-then-write race.
    const res = await query<{ version: number }>(
      `UPDATE dbo.user_trips
         SET data = @data, version = version + 1, updated_at = SYSUTCDATETIME()
         OUTPUT inserted.version
         WHERE user_id = @userId AND trip_id = @tripId AND version = @baseVersion`,
      { ...params, baseVersion: { type: sql.Int, value: baseVersion } },
    )
    const row = res.recordset[0]
    if (!row) return await conflict(user.id, tripId)
    return json<PutTripResponse>({ version: row.version })
  } catch (err) {
    return fromException(err)
  }
}

export async function deleteTrip(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const blocked = csrfGuard(req)
    if (blocked) return blocked
    const user = await validateSession(req)
    if (!user) return error(401, 'Unauthorized')
    const tripId = req.params?.tripId
    if (!validId(tripId)) return error(400, 'Invalid trip id')
    await query(
      `DELETE FROM dbo.user_trips WHERE user_id = @userId AND trip_id = @tripId;
       UPDATE dbo.users SET current_trip_id = NULL WHERE id = @userId AND current_trip_id = @tripId;`,
      {
        userId: { type: sql.UniqueIdentifier, value: user.id },
        tripId: { type: sql.NVarChar(MAX_ID_LENGTH), value: tripId },
      },
    )
    return json<DeleteTripResponse>({ ok: true })
  } catch (err) {
    return fromException(err)
  }
}

export async function importTrips(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const blocked = csrfGuard(req)
    if (blocked) return blocked
    const user = await validateSession(req)
    if (!user) return error(401, 'Unauthorized')
    const read = await readBody(req)
    if (!read.ok) return read.res
    const body = read.body
    if (
      !isObject(body) ||
      !Array.isArray(body.trips) ||
      body.trips.length > MAX_IMPORT_TRIPS ||
      !body.trips.every((t) => isTrip(t) && validId(t.id))
    ) {
      return error(400, 'Invalid trips payload')
    }
    const imported: string[] = []
    const skipped: string[] = []
    const seen = new Set<string>()
    for (const trip of body.trips as Trip[]) {
      if (seen.has(trip.id)) {
        skipped.push(trip.id)
        continue
      }
      seen.add(trip.id)
      try {
        const res = await query(
          `INSERT INTO dbo.user_trips (user_id, trip_id, data)
           SELECT @userId, @tripId, @data
           WHERE NOT EXISTS (SELECT 1 FROM dbo.user_trips WHERE user_id = @userId AND trip_id = @tripId)`,
          {
            userId: { type: sql.UniqueIdentifier, value: user.id },
            tripId: { type: sql.NVarChar(MAX_ID_LENGTH), value: trip.id },
            data: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(sanitizeTrip(trip)) },
          },
        )
        if ((res.rowsAffected?.[0] ?? 0) > 0) imported.push(trip.id)
        else skipped.push(trip.id)
      } catch (err) {
        if (!isDuplicateKey(err)) throw err
        skipped.push(trip.id) // lost a race with a concurrent insert
      }
    }
    return json<ImportTripsResponse>({ imported, skipped })
  } catch (err) {
    return fromException(err)
  }
}

export async function putTripSelection(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const blocked = csrfGuard(req)
    if (blocked) return blocked
    const user = await validateSession(req)
    if (!user) return error(401, 'Unauthorized')
    const read = await readBody(req)
    if (!read.ok) return read.res
    const body = read.body
    if (!isObject(body)) return error(400, 'Invalid request body')
    const id = body.currentTripId
    if (id !== null && !(typeof id === 'string' && id.length <= MAX_ID_LENGTH)) {
      return error(400, 'Invalid request body')
    }
    await query('UPDATE dbo.users SET current_trip_id = @currentTripId WHERE id = @userId', {
      userId: { type: sql.UniqueIdentifier, value: user.id },
      currentTripId: { type: sql.NVarChar(MAX_ID_LENGTH), value: id },
    })
    return json<PutTripSelectionResponse>({ ok: true })
  } catch (err) {
    return fromException(err)
  }
}

app.http('tripsGet', { route: 'trips', methods: ['GET'], authLevel: 'anonymous', handler: getTrips })
app.http('tripsImport', { route: 'trips/import', methods: ['POST'], authLevel: 'anonymous', handler: importTrips })
app.http('tripPut', { route: 'trips/{tripId}', methods: ['PUT'], authLevel: 'anonymous', handler: putTrip })
app.http('tripDelete', { route: 'trips/{tripId}', methods: ['DELETE'], authLevel: 'anonymous', handler: deleteTrip })
app.http('tripSelectionPut', { route: 'trip-selection', methods: ['PUT'], authLevel: 'anonymous', handler: putTripSelection })
