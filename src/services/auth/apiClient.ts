import { fetchWithBackoff } from '../network/request'
import type { ApiErrorBody, ApiResult, PingResponse } from '../../types/auth'

export type ApiRequestOptions = {
  /** Max retries for the 503 database-waking case only. Default 3. */
  maxWakeRetries?: number
  /** Upper bound for a single wait between 503 retries. Default 5000ms. */
  maxWakeDelayMs?: number
}

const CSRF_COOKIE = 'csrf_token'
const CSRF_HEADER = 'X-CSRF-Token'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const DEFAULT_WAKE_RETRIES = 3
const DEFAULT_WAKE_DELAY_MS = 5000
const FALLBACK_WAKE_DELAY_MS = 1000

/** The single permitted document.cookie read: the non-HttpOnly CSRF token. */
const readCsrfToken = (): string | undefined => {
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq > 0 && trimmed.slice(0, eq) === CSRF_COOKIE) {
      const value = trimmed.slice(eq + 1)
      if (!value) return undefined
      try {
        return decodeURIComponent(value)
      } catch {
        return value
      }
    }
  }
  return undefined
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })

const parseRetryAfterSeconds = (value: string | null): number | undefined => {
  if (!value) return undefined
  const seconds = Number.parseInt(value, 10)
  if (!Number.isNaN(seconds) && seconds >= 0) return seconds
  const date = Date.parse(value)
  if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000))
  return undefined
}

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

const toErrorBody = (payload: unknown, status: number): ApiErrorBody => {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const { error, code } = payload as { error: unknown; code?: unknown }
    if (typeof error === 'string') {
      return typeof code === 'string' ? { error, code } : { error }
    }
  }
  return { error: `Request failed (${status})` }
}

const classify = <T>(response: Response, payload: unknown): ApiResult<T> => {
  const { status } = response
  if (response.ok) {
    return { kind: 'success', status, data: payload as T }
  }
  if (status === 503) {
    const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get('Retry-After'))
    return retryAfterSeconds === undefined
      ? { kind: 'database-waking', status: 503 }
      : { kind: 'database-waking', status: 503, retryAfterSeconds }
  }
  const body = toErrorBody(payload, status)
  if (status === 401 || status === 403) return { kind: 'auth-failure', status, ...body }
  if (status === 400 || status === 409 || status === 422) {
    const failure = { kind: 'validation-failure' as const, status, ...body }
    // 409 bodies may carry the server's current record (e.g. trip VERSION_CONFLICT); keep it.
    if (status === 409 && payload && typeof payload === 'object' && 'current' in payload) {
      return { ...failure, current: (payload as { current: unknown }).current } as ApiResult<T>
    }
    return failure
  }
  return { kind: 'error', status, ...body }
}

const sendOnce = async <T>(
  method: string,
  path: string,
  body: unknown,
  csrfToken: string | undefined
): Promise<ApiResult<T>> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (csrfToken) headers[CSRF_HEADER] = csrfToken
  const init: RequestInit = { method, credentials: 'same-origin', headers }
  if (body !== undefined) init.body = JSON.stringify(body)

  try {
    // retries: 0 — this layer owns the (503-only) retry policy; the shared helper adds the timeout.
    const response = await fetchWithBackoff(path, init, { retries: 0 })
    return classify<T>(response, await readJson(response))
  } catch {
    return { kind: 'error', status: 0, error: 'Network error' }
  }
}

/** Bounded retry for 503 only. Never retries a 4xx or any other status. */
const sendWithWakeRetry = async <T>(
  method: string,
  path: string,
  body: unknown,
  csrfToken: string | undefined,
  options: ApiRequestOptions
): Promise<ApiResult<T>> => {
  const maxRetries = options.maxWakeRetries ?? DEFAULT_WAKE_RETRIES
  const maxDelayMs = options.maxWakeDelayMs ?? DEFAULT_WAKE_DELAY_MS
  let attempt = 0
  while (true) {
    const result = await sendOnce<T>(method, path, body, csrfToken)
    if (result.kind !== 'database-waking' || attempt >= maxRetries) return result
    const waitMs =
      result.retryAfterSeconds === undefined
        ? FALLBACK_WAKE_DELAY_MS
        : result.retryAfterSeconds * 1000
    attempt += 1
    await sleep(Math.min(maxDelayMs, waitMs))
  }
}

export const ping = (options: ApiRequestOptions = {}): Promise<ApiResult<PingResponse>> =>
  sendWithWakeRetry<PingResponse>('GET', '/api/ping', undefined, undefined, options)

export const apiRequest = async <T>(
  method: string,
  path: string,
  body?: unknown,
  options: ApiRequestOptions = {}
): Promise<ApiResult<T>> => {
  const upper = method.toUpperCase()
  if (SAFE_METHODS.has(upper)) {
    return sendWithWakeRetry<T>(upper, path, body, undefined, options)
  }

  let csrfToken = readCsrfToken()
  if (!csrfToken) {
    const pinged = await ping(options)
    if (pinged.kind !== 'success') return pinged as ApiResult<T>
    csrfToken = readCsrfToken()
    if (!csrfToken) {
      return { kind: 'error', status: 0, error: 'Missing CSRF token' }
    }
  }
  return sendWithWakeRetry<T>(upper, path, body, csrfToken, options)
}

export const apiGet = <T>(path: string, options?: ApiRequestOptions) =>
  apiRequest<T>('GET', path, undefined, options)
export const apiPost = <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
  apiRequest<T>('POST', path, body, options)
export const apiPut = <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
  apiRequest<T>('PUT', path, body, options)
export const apiDelete = <T>(path: string, options?: ApiRequestOptions) =>
  apiRequest<T>('DELETE', path, undefined, options)
