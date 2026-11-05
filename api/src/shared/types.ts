// Wire types shared between the API and the SPA (task 08 mirrors this file on the client).
// TripsState is mirrored BY STRUCTURE from src/domain/trip/types.ts; that file is not
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

export type TripsState = {
  trips: Trip[]
  currentTripId: string | null
}

// ---- Common ----
export type ApiUser = {
  id: string
  email: string
}

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

// ---- GET /api/trips ----
export type GetTripsResponse = TripsState

// ---- PUT /api/trips ----
export type PutTripsRequest = TripsState
export type PutTripsResponse = { ok: true }
