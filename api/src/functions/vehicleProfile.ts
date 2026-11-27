// Vehicle profile API over dbo.vehicle_profiles (one row per user, JSON in `data`).
// user_id comes ONLY from the validated session.
//   GET /api/vehicle-profile   the caller's profile, or { profile: null }
//   PUT /api/vehicle-profile   validate and upsert the caller's profile
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
  VEHICLE_NAME_MAX_LENGTH,
} from '../shared/types'
import type {
  GetVehicleProfileResponse,
  PutVehicleProfileRequest,
  PutVehicleProfileResponse,
  VehicleProfile,
} from '../shared/types'

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function inRange(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
}

type Validated = { ok: true; profile: VehicleProfile } | { ok: false; message: string }

/** Validates a PutVehicleProfileRequest body; returns the normalised profile (extra fields dropped). */
function validate(body: unknown): Validated {
  if (!isObject(body) || !isObject(body.profile)) {
    return { ok: false, message: 'profile must be an object' }
  }
  const p = body.profile as Partial<Record<keyof VehicleProfile, unknown>>
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
    profile: { name: p.name.trim(), fuelType: p.fuelType, mpg: p.mpg, tankGallons: p.tankGallons },
  }
}

function parseRow(data: string): VehicleProfile | null {
  try {
    const r = validate({ profile: JSON.parse(data) })
    return r.ok ? r.profile : null
  } catch {
    return null
  }
}

export async function getVehicleProfile(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const user = await validateSession(req)
    if (!user) return error(401, 'Unauthorized')
    const rows = await query<{ data: string }>('SELECT data FROM dbo.vehicle_profiles WHERE user_id = @userId', {
      userId: { type: sql.UniqueIdentifier, value: user.id },
    })
    const row = rows.recordset[0]
    return json<GetVehicleProfileResponse>({ profile: row ? parseRow(row.data) : null })
  } catch (err) {
    return fromException(err)
  }
}

export async function putVehicleProfile(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const denied = csrfGuard(req)
    if (denied) return denied
    const user = await validateSession(req)
    if (!user) return error(401, 'Unauthorized')
    let body: PutVehicleProfileRequest | unknown
    try {
      body = JSON.parse(await req.text())
    } catch {
      return error(400, 'Invalid request body')
    }
    const result = validate(body)
    if (!result.ok) return error(400, result.message)
    await query(
      `MERGE dbo.vehicle_profiles AS t
USING (SELECT @userId AS user_id) AS s ON t.user_id = s.user_id
WHEN MATCHED THEN UPDATE SET data = @data, updated_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT (user_id, data, updated_at) VALUES (@userId, @data, SYSUTCDATETIME());`,
      {
        userId: { type: sql.UniqueIdentifier, value: user.id },
        data: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(result.profile) },
      },
    )
    return json<PutVehicleProfileResponse>({ profile: result.profile })
  } catch (err) {
    return fromException(err)
  }
}

app.http('getVehicleProfile', {
  route: 'vehicle-profile',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: getVehicleProfile,
})
app.http('putVehicleProfile', {
  route: 'vehicle-profile',
  methods: ['PUT'],
  authLevel: 'anonymous',
  handler: putVehicleProfile,
})
