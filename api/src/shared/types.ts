// Wire types shared between the API and the SPA (task 08 mirrors this file on the client).
// Trip is mirrored BY STRUCTURE from src/domain/trip/types.ts; that file is not
// imported across the project boundary and must not be modified.

// ---- Trips payload (structural mirror of src/domain/trip/types.ts) ----
export type TripStopStatus = 'idle' | 'geocoding' | 'ready' | 'error'
export type TripStopSourceName =
  | 'RV Life'
  | 'Hipcamp'
  | 'Campendium'
  | 'Harvest Hosts'
  | 'RV Parky'
  | 'Other'
export type ReservationStatus = 'reserved' | 'unreserved'

export type TripStopSource = {
  name: TripStopSourceName
  url?: string
  siteType?: string
  fees?: string
  amenities?: string
}

export type TripStop = {
  id: string
  label: string
  address: string
  startDate: string
  endDate: string
  checkInTime?: string
  checkOutTime?: string
  note?: string
  source?: TripStopSource
  location?: { lat: number; lng: number }
  status?: TripStopStatus
  manualEntry?: boolean
  distanceFromPreviousMeters?: number
  estimatedFuelCost?: number
  reservationStatus?: ReservationStatus
  confirmationNumber?: string
  siteNumber?: string
  contactPhone?: string
  nightlyCost?: number
  actualGasCost?: number
  actualFoodCost?: number
  actualMiscCost?: number
  reservationNote?: string
}

export type Trip = {
  id: string
  name: string
  stops: TripStop[]
  createdAt: string
  updatedAt: string
  vehicleSettings?: { mpg: number }
}

// ---- Common ----
export type ApiUser = {
  id: string
  email: string
  isAdmin: boolean
}

/** Machine-readable error codes carried in ApiError.code. */
export const API_ERROR_CODES = [
  'VERSION_CONFLICT',
  'RATE_LIMITED',
  'EMAIL_FAILED',
  'PAYLOAD_TOO_LARGE',
  'DATABASE_UNAVAILABLE',
] as const
export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

/** Body of every error response. Never contains stack traces, SQL or connection details. */
export type ApiError = {
  error: string
  code?: string
}

// ---- GET /api/ping ----
export type PingResponse = { ok: true }

// ---- POST /api/register ----
export type RegisterRequest = {
  email: string
  password: string
  inviteCode: string
}
export type RegisterResponse = { user: ApiUser }

// ---- POST /api/login ----
export type LoginRequest = {
  email: string
  password: string
}
export type LoginResponse = { user: ApiUser }

// ---- POST /api/logout ----
export type LogoutRequest = Record<string, never>
export type LogoutResponse = { ok: true }

// ---- GET /api/me ----
export type MeResponse = { user: ApiUser }

// ---- POST /api/forgot-password ----
export type ForgotPasswordRequest = { email: string }
/** Always returned with 200 to avoid account enumeration. */
export type ForgotPasswordResponse = { ok: true }

// ---- POST /api/reset-password ----
export type ResetPasswordRequest = {
  token: string
  password: string
}
export type ResetPasswordResponse = { ok: true }

// ---- Per-trip persistence ----
export type VersionedTrip = { trip: Trip; version: number }

// GET /api/trips
export type GetTripsResponse = { trips: VersionedTrip[]; currentTripId: string | null }

// PUT /api/trips/{id} (baseVersion null = create)
export type PutTripRequest = { trip: Trip; baseVersion: number | null }
export type PutTripResponse = { version: number }
export type TripConflictResponse = ApiError & {
  code: 'VERSION_CONFLICT'
  current: VersionedTrip | null
}

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
