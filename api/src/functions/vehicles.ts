// Vehicle garage API over dbo.vehicle_profiles (one row per user, JSON in `data`).
// user_id comes ONLY from the validated session.
//   GET /api/vehicles   the caller's garage, or { garage: null }
//   PUT /api/vehicles   validate and upsert the caller's garage
// Legacy rows hold a single VehicleProfile; GET reads them as a one-vehicle garage.
import { app } from '@azure/functions'
import type { HttpRequest, HttpResponseInit } from '@azure/functions'
import { query, sql } from '../shared/db'
import { csrfGuard, error, fromException, json } from '../shared/http'
import { validateSession } from '../shared/session'
import {
  MPG_MAX,
  MPG_MIN,
  TANK_GALLONS_MAX,
  TANK_GALLONS_MIN,
  VEHICLES_BODY_MAX_BYTES,
  VEHICLES_MAX,
  VEHICLE_ID_PATTERN,
  VEHICLE_NAME_MAX_LENGTH,
} from '../shared/types'
import type {
  GetVehiclesResponse,
  PutVehiclesResponse,
  Vehicle,
  VehicleGarage,
  VehicleProfile,
} from '../shared/types'

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function inRange(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
}

type Result<T> = { ok: true; value: T } | { ok: false; message: string }

/** Validates one profile's fields; returns the normalised profile (extra fields dropped). */
function validateProfile(p: Partial<Record<keyof VehicleProfile, unknown>>): Result<VehicleProfile> {
  if (typeof p.name !== 'string' || p.name.trim().length > VEHICLE_NAME_MAX_LENGTH) {
    return { ok: false, message: `name must be a string of at most ${VEHICLE_NAME_MAX_LENGTH} characters` }
  }
  if (p.fuelType !== 'gasoline' && p.fuelType !== 'diesel') {
    return { ok: false, message: 'fuelType must be gasoline or diesel' }
  }
  if (!inRange(p.mpg, MPG_MIN, MPG_MAX)) {
    return { ok: false, message: `mpg must be a number between ${MPG_MIN} and ${MPG_MAX}` }
  }
  if (p.tankGallons !== null && !inRange(p.tankGallons, TANK_GALLONS_MIN, TANK_GALLONS_MAX)) {
    return {
      ok: false,
      message: `tankGallons must be null or a number between ${TANK_GALLONS_MIN} and ${TANK_GALLONS_MAX}`,
    }
  }
  return {
    ok: true,
    value: { name: p.name.trim(), fuelType: p.fuelType, mpg: p.mpg, tankGallons: p.tankGallons },
  }
}

/** Validates a garage value; returns the normalised garage. */
function validateGarage(g: unknown): Result<VehicleGarage> {
  if (!isObject(g)) return { ok: false, message: 'garage must be an object' }
  const list = g.vehicles
  if (!Array.isArray(list) || list.length === 0 || list.length > VEHICLES_MAX) {
    return { ok: false, message: `vehicles must be an array of 1 to ${VEHICLES_MAX} vehicles` }
  }
  const seen = new Set<string>()
  const vehicles: Vehicle[] = []
  for (const raw of list) {
    if (!isObject(raw)) return { ok: false, message: 'each vehicle must be an object' }
    if (typeof raw.id !== 'string' || !VEHICLE_ID_PATTERN.test(raw.id)) {
      return { ok: false, message: 'vehicle id is invalid' }
    }
    if (seen.has(raw.id)) return { ok: false, message: 'vehicle ids must be unique' }
    seen.add(raw.id)
    const r = validateProfile(raw)
    if (!r.ok) return r
    vehicles.push({ id: raw.id, ...r.value })
  }
  if (typeof g.defaultVehicleId !== 'string' || !seen.has(g.defaultVehicleId)) {
    return { ok: false, message: 'defaultVehicleId must be the id of one of the vehicles' }
  }
  return { ok: true, value: { vehicles, defaultVehicleId: g.defaultVehicleId } }
}

/** Reads a stored row: a garage, or a legacy single profile promoted to a one-vehicle garage. */
function parseRow(data: string, userId: string): VehicleGarage | null {
  try {
    const parsed: unknown = JSON.parse(data)
    if (isObject(parsed) && 'vehicles' in parsed) {
      const g = validateGarage(parsed)
      return g.ok ? g.value : null
    }
    if (!isObject(parsed)) return null
    const p = validateProfile(parsed)
    if (!p.ok) return null
    const id = userId.toLowerCase()
    return { vehicles: [{ ...p.value, id }], defaultVehicleId: id }
  } catch {
    return null
  }
}

export async function getVehicles(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const user = await validateSession(req)
    if (!user) return error(401, 'Unauthorized')
    const rows = await query<{ data: string }>('SELECT data FROM dbo.vehicle_profiles WHERE user_id = @userId', {
      userId: { type: sql.UniqueIdentifier, value: user.id },
    })
    const row = rows.recordset[0]
    return json<GetVehiclesResponse>({ garage: row ? parseRow(row.data, user.id) : null })
  } catch (err) {
    return fromException(err)
  }
}

export async function putVehicles(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const denied = csrfGuard(req)
    if (denied) return denied
    const user = await validateSession(req)
    if (!user) return error(401, 'Unauthorized')
    const tooLarge = () => error(413, 'Payload too large', 'PAYLOAD_TOO_LARGE')
    const declared = Number(req.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > VEHICLES_BODY_MAX_BYTES) return tooLarge()
    let text: string
    try {
      text = await req.text()
    } catch {
      return error(400, 'Invalid request body')
    }
    if (Buffer.byteLength(text, 'utf8') > VEHICLES_BODY_MAX_BYTES) return tooLarge()
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return error(400, 'Invalid request body')
    }
    const result = validateGarage(isObject(body) ? body.garage : undefined)
    if (!result.ok) return error(400, result.message)
    await query(
      `MERGE dbo.vehicle_profiles AS t
USING (SELECT @userId AS user_id) AS s ON t.user_id = s.user_id
WHEN MATCHED THEN UPDATE SET data = @data, updated_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT (user_id, data, updated_at) VALUES (@userId, @data, SYSUTCDATETIME());`,
      {
        userId: { type: sql.UniqueIdentifier, value: user.id },
        data: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(result.value) },
      },
    )
    return json<PutVehiclesResponse>({ garage: result.value })
  } catch (err) {
    return fromException(err)
  }
}

app.http('getVehicles', { route: 'vehicles', methods: ['GET'], authLevel: 'anonymous', handler: getVehicles })
app.http('putVehicles', { route: 'vehicles', methods: ['PUT'], authLevel: 'anonymous', handler: putVehicles })
