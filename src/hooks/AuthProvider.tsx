import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import * as authClient from '../services/auth/authClient';
import type { ApiResult, AuthUser } from '../types/auth';
import { AuthContext } from './authContext';
import type { AuthContextType, AuthStatus } from './authContext';

/** Max automatic session re-checks while the database is waking. */
export const MAX_WAKE_RETRIES = 1;
// apiClient already retries 503 internally (3 x <=5s); keep this outer layer small so the
// worst-case "waking" window stays around 30s (15s + 1s + 15s) instead of multiplying.
const DEFAULT_WAKE_DELAY_MS = 1000;
const MAX_WAKE_DELAY_MS = 1000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [user, setUser] = useState<AuthUser | null>(null);
  const mounted = useRef(true);

  const setUnauthenticated = useCallback(() => {
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  // Session resolution: ping first (fire-and-forget), then getCurrentUser with bounded 503 retry.
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void authClient.ping().catch(() => undefined);

    const resolve = async (attempt: number): Promise<void> => {
      let result: ApiResult<{ user: AuthUser }>;
      try {
        result = await authClient.getCurrentUser();
      } catch {
        if (!cancelled) setUnauthenticated();
        return;
      }
      if (cancelled) return;
      // A 200 with no JSON body means the API is not running (the Vite dev
      // server answers /api/* with index.html), so treat it as signed out.
      if (result.kind === 'success' && !result.data?.user) {
        setUnauthenticated();
      } else if (result.kind === 'success') {
        setUser(result.data.user);
        setStatus('authenticated');
      } else if (result.kind === 'database-waking') {
        setStatus('databaseWaking');
        if (attempt < MAX_WAKE_RETRIES) {
          const delay = Math.min(
            (result.retryAfterSeconds ?? DEFAULT_WAKE_DELAY_MS / 1000) * 1000,
            MAX_WAKE_DELAY_MS
          );
          timer = setTimeout(() => void resolve(attempt + 1), delay);
        } else {
          // Retries exhausted: settle as unauthenticated so the UI is not stuck.
          setUnauthenticated();
        }
      } else {
        setUnauthenticated();
      }
    };
    void resolve(0);

    return () => {
      cancelled = true;
      mounted.current = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [setUnauthenticated]);

  const login = useCallback<AuthContextType['login']>(async (req) => {
    const result = await authClient.login(req);
    if (!mounted.current) return result;
    if (result.kind === 'success') {
      setUser(result.data.user);
      setStatus('authenticated');
    } else if (result.kind === 'auth-failure') {
      setUnauthenticated();
    }
    return result;
  }, [setUnauthenticated]);

  const register = useCallback<AuthContextType['register']>(async (req) => {
    const result = await authClient.register(req);
    if (!mounted.current) return result;
    if (result.kind === 'success') {
      setUser(result.data.user);
      setStatus('authenticated');
    } else if (result.kind === 'auth-failure') {
      setUnauthenticated();
    }
    return result;
  }, [setUnauthenticated]);

  const logout = useCallback<AuthContextType['logout']>(async () => {
    const result = await authClient.logout();
    // Auth state is dropped on success or 401 (already logged out).
    if (mounted.current && (result.kind === 'success' || result.kind === 'auth-failure')) {
      setUnauthenticated();
    }
    return result;
  }, [setUnauthenticated]);

  const requestPasswordReset = useCallback<AuthContextType['requestPasswordReset']>(
    async (req) => {
      const result = await authClient.requestPasswordReset(req);
      if (mounted.current && result.kind === 'auth-failure') setUnauthenticated();
      return result;
    },
    [setUnauthenticated]
  );

  const resetPassword = useCallback<AuthContextType['resetPassword']>(
    async (req) => {
      const result = await authClient.resetPassword(req);
      if (mounted.current && result.kind === 'auth-failure') setUnauthenticated();
      return result;
    },
    [setUnauthenticated]
  );

  const value = useMemo<AuthContextType>(
    () => ({ status, user, login, register, logout, requestPasswordReset, resetPassword }),
    [status, user, login, register, logout, requestPasswordReset, resetPassword]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
