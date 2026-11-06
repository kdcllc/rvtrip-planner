// Client-side mirror of api/src/shared/types.ts. Redeclared (not imported) because
// api/ and src/ compile as separate projects. Keep structurally in sync.

export type AuthUser = {
  id: string
  email: string
  isAdmin: boolean
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: AuthUser }
  | { status: 'waking' }

/** Body of every API error response. */
export type ApiErrorBody = {
  error: string
  code?: string
}

export type PingResponse = { ok: true }

export type RegisterRequest = { email: string; password: string; inviteCode: string }
export type RegisterResponse = { user: AuthUser }

export type LoginRequest = { email: string; password: string }
export type LoginResponse = { user: AuthUser }

export type LogoutResponse = { ok: true }

export type MeResponse = { user: AuthUser }

export type ForgotPasswordRequest = { email: string }
export type ForgotPasswordResponse = { ok: true }

export type ResetPasswordRequest = { token: string; password: string }
export type ResetPasswordResponse = { ok: true }

/** Discriminated outcome of every API call. */
export type ApiResult<T> =
  | { kind: 'success'; status: number; data: T }
  | { kind: 'auth-failure'; status: number; error: string; code?: string }
  | { kind: 'validation-failure'; status: number; error: string; code?: string }
  | { kind: 'database-waking'; status: 503; retryAfterSeconds?: number }
  | { kind: 'error'; status: number; error: string; code?: string }
