// Client-side mirror of api/src/shared/types.ts (per-trip persistence and invite requests).
// Redeclared structurally; keep in sync.
import type { Trip } from '../domain/trip/types'

/** Body of every API error response. */
export type ApiError = {
  error: string
  code?: string
}

// ---- Per-trip persistence ----
export type VersionedTrip = { trip: Trip; version: number }

// GET /api/trips
export type GetTripsResponse = { trips: VersionedTrip[]; currentTripId: string | null }

// PUT /api/trips/{id} (baseVersion null = create)
export type PutTripRequest = { trip: Trip; baseVersion: number | null }
export type PutTripResponse = { version: number }

// DELETE /api/trips/{id}
export type DeleteTripResponse = { ok: true }

// POST /api/trips/import
export type ImportTripsRequest = { trips: Trip[] }
export type ImportTripsResponse = { imported: string[]; skipped: string[] }

// PUT /api/trips/selection
export type PutTripSelectionRequest = { currentTripId: string | null }
export type PutTripSelectionResponse = { ok: true }

// ---- Invite requests ----
export type InviteRequestStatus = 'pending' | 'invited' | 'declined' | 'registered'

// POST /api/invite-requests (`website` is a honeypot field)
export type CreateInviteRequest = {
  email: string
  name: string
  note?: string
  website?: string
}
export type CreateInviteResponse = { ok: true }

export type AdminInviteRequest = {
  id: string
  email: string
  name: string
  note: string | null
  status: InviteRequestStatus
  createdAt: string
  invitedAt: string | null
  inviteCount: number
}
export type ListInviteRequestsResponse = { requests: AdminInviteRequest[] }
export type InviteActionResponse = { request: AdminInviteRequest }
// POST /api/manage/invites (admin only). Blank/missing name defaults server-side to the email local part.
export type CreateAdminInvite = { email: string; name?: string }
// Returned by POST /api/manage/invites and POST /api/manage/invite-requests/{id}/invite.
// inviteLink carries the plain one-time code: shown to the admin once, never stored or logged.
// emailSent=false means the email failed or is not configured; the code stays valid.
export type InviteSentResponse = { request: AdminInviteRequest; inviteLink: string; emailSent: boolean }
/** Response of POST /api/manage/test-email. */
export type TestEmailResponse = { sentTo: string; sender: string }
/** Minimum seconds between test emails per admin (429 RATE_LIMITED inside the window). */
export const TEST_EMAIL_COOLDOWN_SECONDS = 60

// ---- Vehicle profile and fuel price history ----
export type FuelType = 'gasoline' | 'diesel'
export type VehicleProfile = { name: string; fuelType: FuelType; mpg: number; tankGallons: number | null }
export type Vehicle = VehicleProfile & { id: string }
export type VehicleGarage = { vehicles: Vehicle[]; defaultVehicleId: string }
// GET /api/vehicles
export type GetVehiclesResponse = { garage: VehicleGarage | null }
// PUT /api/vehicles
export type PutVehiclesRequest = { garage: VehicleGarage }
export type PutVehiclesResponse = { garage: VehicleGarage }
export const VEHICLES_MAX = 10
export const VEHICLE_ID_MAX_LENGTH = 64
export const VEHICLE_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/
export const VEHICLES_BODY_MAX_BYTES = 16384
/** One weekly price: week is YYYY-MM-DD, price is USD per gallon. */
export type FuelPricePoint = { week: string; price: number }
// GET /api/fuel-prices
export type GetFuelPricesResponse = {
  area: string
  product: string
  configured: boolean
  points: FuelPricePoint[]
  latest: FuelPricePoint | null
}
export const VEHICLE_NAME_MAX_LENGTH = 80
export const MPG_MIN = 5
export const MPG_MAX = 100
export const TANK_GALLONS_MIN = 1
export const TANK_GALLONS_MAX = 300
export const FUEL_PRICE_MAX_RANGE_DAYS = 400
