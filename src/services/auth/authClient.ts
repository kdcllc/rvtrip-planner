import { apiGet, apiPost, ping as pingApi } from './apiClient'
import type {
  ApiResult,
  AuthUser,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  MeResponse,
  PingResponse,
  RegisterRequest,
  RegisterResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
} from '../../types/auth'

export const ping = (): Promise<ApiResult<PingResponse>> => pingApi()

/** Ensure `user.isAdmin` is always a boolean (default false when absent from the response). */
const withIsAdmin = <T extends { user: AuthUser }>(result: ApiResult<T>): ApiResult<T> => {
  if (result.kind !== 'success' || !result.data?.user) return result
  const user: AuthUser = { ...result.data.user, isAdmin: result.data.user.isAdmin === true }
  return { ...result, data: { ...result.data, user } }
}

export const register = async (req: RegisterRequest): Promise<ApiResult<RegisterResponse>> =>
  withIsAdmin(await apiPost<RegisterResponse>('/api/register', req))

export const login = async (req: LoginRequest): Promise<ApiResult<LoginResponse>> =>
  withIsAdmin(await apiPost<LoginResponse>('/api/login', req))

export const logout = (): Promise<ApiResult<LogoutResponse>> =>
  apiPost<LogoutResponse>('/api/logout', {})

export const getCurrentUser = async (): Promise<ApiResult<MeResponse>> =>
  withIsAdmin(await apiGet<MeResponse>('/api/me'))

export const requestPasswordReset = (
  req: ForgotPasswordRequest
): Promise<ApiResult<ForgotPasswordResponse>> =>
  apiPost<ForgotPasswordResponse>('/api/forgot-password', req)

export const resetPassword = (
  req: ResetPasswordRequest
): Promise<ApiResult<ResetPasswordResponse>> =>
  apiPost<ResetPasswordResponse>('/api/reset-password', req)
