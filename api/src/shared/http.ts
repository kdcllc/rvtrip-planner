// HTTP response envelope, cookie helpers and the CSRF guard.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { Cookie, HttpResponseInit } from '@azure/functions'
import { requireSetting } from './config'
import { DatabaseUnavailableError } from './db'

export const SESSION_COOKIE = 'session'
export const CSRF_COOKIE = 'csrf_token'
export const CSRF_HEADER = 'x-csrf-token'
export const DB_WAKING_RETRY_AFTER_SECONDS = 20

/** Minimal request surface used by the helpers (satisfied by HttpRequest). */
export type RequestLike = {
  method: string
  headers: { get(name: string): string | null }
}

// ---- Responses ----

/** Success: the given object is the body, unchanged (no wrapper). */
export function json<T>(body: T, status = 200): HttpResponseInit {
  return { status, jsonBody: body }
}

/** Error: fixed `{ error, code? }` shape. Callers pass safe, generic messages only. */
export function error(status: number, message: string, code?: string): HttpResponseInit {
  return { status, jsonBody: code ? { error: message, code } : { error: message } }
}

/** 503 + Retry-After for the paused-database (40613) path. Never waits. */
export function databaseWaking(): HttpResponseInit {
  return {
    status: 503,
    headers: { 'Retry-After': String(DB_WAKING_RETRY_AFTER_SECONDS) },
    jsonBody: { error: 'Database is waking up, please retry shortly', code: 'DATABASE_UNAVAILABLE' },
  }
}

/** Maps an unexpected exception to a safe response; leaks no stack, SQL or connection info. */
export function fromException(err: unknown): HttpResponseInit {
  if (err instanceof DatabaseUnavailableError) return databaseWaking()
  return error(500, 'Internal server error')
}

// ---- Cookies ----

/** Serialises a Functions Cookie object to a Set-Cookie header value. */
export function serializeCookie(c: Cookie): string {
  const parts = [`${c.name}=${c.value}`]
  if (c.maxAge !== undefined) parts.push(`Max-Age=${c.maxAge}`)
  parts.push(`Path=${c.path ?? '/'}`)
  if (c.httpOnly) parts.push('HttpOnly')
  if (c.secure) parts.push('Secure')
  if (c.sameSite) parts.push(`SameSite=${c.sameSite}`)
  return parts.join('; ')
}

export function sessionCookie(token: string, maxAgeSeconds: number): Cookie {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: maxAgeSeconds,
  }
}

export function clearSessionCookie(): Cookie {
  return { ...sessionCookie('', 0), maxAge: 0 }
}

/**
 * CSRF token issuance: random token in a NON-HttpOnly cookie so client JS can echo it in the
 * X-CSRF-Token header (double-submit). Separate from the HttpOnly session cookie.
 *
 * GET /api/ping and EVERY session-establishing response (login, register) issue this token.
 * /api/ping is unauthenticated and the SPA calls it on mount, so a first-time visitor
 * already holds a valid CSRF token before submitting the login form; otherwise the guard
 * would 403 the very requests that establish a session.
 */
export function csrfCookie(token: string = randomBytes(32).toString('base64url')): Cookie {
  return {
    name: CSRF_COOKIE,
    value: token,
    httpOnly: false,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  }
}

/** Returns a copy of `res` with the given cookies appended. */
export function withCookies(res: HttpResponseInit, ...cookies: Cookie[]): HttpResponseInit {
  const existing = Array.isArray(res.cookies) ? res.cookies : []
  return { ...res, cookies: [...existing, ...cookies] }
}

export function readCookie(req: RequestLike, name: string): string | undefined {
  const header = req.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim()
  }
  return undefined
}

// ---- CSRF guard ----

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

function originMatches(req: RequestLike, baseUrl: string): boolean {
  let expected: string
  try {
    expected = new URL(baseUrl).origin
  } catch {
    return false
  }
  const origin = req.headers.get('origin')
  if (origin) return origin === expected
  const referer = req.headers.get('referer')
  if (referer) {
    try {
      return new URL(referer).origin === expected
    } catch {
      return false
    }
  }
  return false
}

/**
 * Returns a 403 response when a state-changing request fails the Origin/Referer check or the
 * double-submit token check; returns null when the request may proceed. GET (and HEAD/OPTIONS)
 * are never guarded, including /api/ping and GET /api/trips.
 */
export function csrfGuard(req: RequestLike): HttpResponseInit | null {
  if (!STATE_CHANGING.has(req.method.toUpperCase())) return null
  const deny = () => error(403, 'Forbidden', 'CSRF')
  if (!originMatches(req, requireSetting('APP_BASE_URL'))) return deny()
  const header = req.headers.get(CSRF_HEADER)
  const cookie = readCookie(req, CSRF_COOKIE)
  if (!header || !cookie || !safeEqual(header, cookie)) return deny()
  return null
}
