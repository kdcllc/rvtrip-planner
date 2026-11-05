import { apiGet, apiPost, ping as pingApi } from './apiClient'
import type {
  ApiResult,
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

export const register = (req: RegisterRequest): Promise<ApiResult<RegisterResponse>> =>
  apiPost<RegisterResponse>('/api/register', req)

export const login = (req: LoginRequest): Promise<ApiResult<LoginResponse>> =>
  apiPost<LoginResponse>('/api/login', req)

export const logout = (): Promise<ApiResult<LogoutResponse>> =>
  apiPost<LogoutResponse>('/api/logout', {})

export const getCurrentUser = (): Promise<ApiResult<MeResponse>> =>
  apiGet<MeResponse>('/api/me')

export const requestPasswordReset = (
  req: ForgotPasswordRequest
): Promise<ApiResult<ForgotPasswordResponse>> =>
  apiPost<ForgotPasswordResponse>('/api/forgot-password', req)

export const resetPassword = (
  req: ResetPasswordRequest
): Promise<ApiResult<ResetPasswordResponse>> =>
  apiPost<ResetPasswordResponse>('/api/reset-password', req)
