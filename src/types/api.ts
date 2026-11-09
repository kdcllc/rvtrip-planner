// Client-side mirror of api/src/shared/types.ts (per-trip persistence and invite requests).
// Redeclared structurally; keep in sync.
import type { Trip } from '../domain/trip/types'

export const API_ERROR_CODES = [
  'VERSION_CONFLICT',
  'RATE_LIMITED',
  'EMAIL_FAILED',
  'PAYLOAD_TOO_LARGE',
  'DATABASE_UNAVAILABLE',
] as const
export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

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
