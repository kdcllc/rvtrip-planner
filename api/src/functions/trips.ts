// GET/PUT /api/trips: the caller's trips (one row in dbo.trips, JSON in `data`).
// user_id comes ONLY from the validated session. No retry/sleep on 40613: the shared 503 path.
import { app } from '@azure/functions'
import type { HttpRequest, HttpResponseInit } from '@azure/functions'
import { query, sql } from '../shared/db'
import { csrfGuard, error, fromException, json } from '../shared/http'
import { validateSession } from '../shared/session'
import type { GetTripsResponse, PutTripsResponse, TripsState } from '../shared/types'

/** SWA request ceiling is 30 MB. */
export const MAX_BODY_BYTES = 30 * 1024 * 1024

const EMPTY_STATE: TripsState = { trips: [], currentTripId: null }

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isStop(v: unknown): boolean {
  return isObject(v) && typeof v.id === 'string' && typeof v.label === 'string'
}

function isTrip(v: unknown): boolean {
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

/** Returns a TripsState holding only the known top-level fields, or null when malformed. */
export function parseTripsState(v: unknown): TripsState | null {
  if (!isObject(v)) return null
  if (!Array.isArray(v.trips) || !v.trips.every(isTrip)) return null
  if (v.currentTripId !== null && typeof v.currentTripId !== 'string') return null
  return { trips: v.trips as TripsState['trips'], currentTripId: v.currentTripId }
}

export async function getTrips(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const user = await validateSession(req)
    if (!user) return error(401, 'Unauthorized')
    const result = await query<{ data: string }>(
      'SELECT TOP 1 data FROM dbo.trips WHERE user_id = @userId ORDER BY updated_at DESC',
      { userId: { type: sql.UniqueIdentifier, value: user.id } },
    )
    const row = result.recordset[0]
    if (!row) return json<GetTripsResponse>({ ...EMPTY_STATE })
    let parsed: TripsState | null = null
    try {
      parsed = parseTripsState(JSON.parse(row.data))
    } catch {
      parsed = null
    }
    return json<GetTripsResponse>(parsed ?? { ...EMPTY_STATE })
  } catch (err) {
    return fromException(err)
  }
}

export async function putTrips(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const blocked = csrfGuard(req)
    if (blocked) return blocked
    const user = await validateSession(req)
    if (!user) return error(401, 'Unauthorized')

    const declared = Number(req.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return error(413, 'Payload too large', 'PAYLOAD_TOO_LARGE')
    }
    let text: string
    try {
      text = await req.text()
    } catch {
      return error(400, 'Invalid request body')
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
      return error(413, 'Payload too large', 'PAYLOAD_TOO_LARGE')
    }
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return error(400, 'Invalid request body')
    }
    const state = parseTripsState(body)
    if (!state) return error(400, 'Invalid trips payload')

    // Re-serialised from the validated fields only: unknown keys (e.g. user_id) never reach the DB.
    await query(
      `UPDATE dbo.trips SET data = @data, updated_at = SYSUTCDATETIME() WHERE user_id = @userId;
       IF @@ROWCOUNT = 0
         INSERT INTO dbo.trips (user_id, data) VALUES (@userId, @data);`,
      {
        userId: { type: sql.UniqueIdentifier, value: user.id },
        data: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(state) },
      },
    )
    return json<PutTripsResponse>({ ok: true })
  } catch (err) {
    return fromException(err)
  }
}

app.http('tripsGet', { route: 'trips', methods: ['GET'], authLevel: 'anonymous', handler: getTrips })
app.http('tripsPut', { route: 'trips', methods: ['PUT'], authLevel: 'anonymous', handler: putTrips })
