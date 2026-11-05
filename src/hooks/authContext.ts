import { createContext } from 'react';

import type {
  ApiResult,
  AuthUser,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  RegisterRequest,
  RegisterResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
} from '../types/auth';

export type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated' | 'databaseWaking';

export interface AuthContextType {
  status: AuthStatus;
  user: AuthUser | null;
  login: (req: LoginRequest) => Promise<ApiResult<LoginResponse>>;
  register: (req: RegisterRequest) => Promise<ApiResult<RegisterResponse>>;
  logout: () => Promise<ApiResult<LogoutResponse>>;
  requestPasswordReset: (
    req: ForgotPasswordRequest
  ) => Promise<ApiResult<ForgotPasswordResponse>>;
  resetPassword: (req: ResetPasswordRequest) => Promise<ApiResult<ResetPasswordResponse>>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
