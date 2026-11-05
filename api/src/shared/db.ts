// Single mssql connection pool for the whole Functions host.
//
// COST-CRITICAL: pool.min MUST stay 0. A non-zero min keeps sockets open, which stops the
// serverless Azure SQL database from ever auto-pausing and burns the entire monthly
// vCore-second free grant in roughly 40 hours. The pool OBJECT is reused across
// invocations (Functions guidance) while its SOCKETS close after a short idle timeout.
//
// SWA kills any request at 45 seconds, so a paused database (error 40613) must be reported
// immediately (503 + Retry-After via http.ts) -- never retried in a loop or waited on here.

import sql from 'mssql'
import { requireSetting } from './config'

export const SQL_ERROR_DATABASE_UNAVAILABLE = 40613

export const POOL_OPTIONS = {
  min: 0, // do NOT raise: see header comment
  max: 5,
  idleTimeoutMillis: 15000, // <= 30000 so idle sockets close and the DB can pause
} as const

/** Fail fast on a paused database; the client retries from its "waking up" state. */
const CONNECTION_TIMEOUT_MS = 10000

/** Typed condition for SQL error 40613 ("database is unavailable"). */
export class DatabaseUnavailableError extends Error {
  readonly code = 'DATABASE_UNAVAILABLE'
  constructor() {
    super('Database is unavailable (resuming)')
    this.name = 'DatabaseUnavailableError'
  }
}

type MaybeSqlError = {
  number?: unknown
  code?: unknown
  message?: unknown
  originalError?: { number?: unknown; code?: unknown; message?: unknown; info?: { number?: unknown } }
}

// Login-phase 40613 reaches us as ConnectionError code ELOGIN with the number dropped.
const UNAVAILABLE_TEXT = /is not currently available/i

/** True only for SQL error 40613 (by number, or by its ELOGIN message text). */
export function isDatabaseUnavailable(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as MaybeSqlError
  const numbers = [e.number, e.originalError?.number, e.originalError?.info?.number]
  if (numbers.some((n) => n === SQL_ERROR_DATABASE_UNAVAILABLE)) return true
  const candidates = [e, e.originalError]
  return candidates.some(
    (c) => c?.code === 'ELOGIN' && typeof c.message === 'string' && UNAVAILABLE_TEXT.test(c.message),
  )
}

// Module-scope singleton: the pool is created once, on first use, and reused thereafter.
let poolPromise: Promise<sql.ConnectionPool> | undefined

function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    const base = sql.ConnectionPool.parseConnectionString(requireSetting('SQL_CONNECTION_STRING'))
    const pool = new sql.ConnectionPool({
      ...base,
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      pool: { ...POOL_OPTIONS },
    })
    poolPromise = pool.connect().catch((err: unknown) => {
      poolPromise = undefined // allow a later request to try again; no loop here
      throw err
    })
  }
  return poolPromise
}

export type SqlParam = {
  type: sql.ISqlTypeFactoryWithNoParams | sql.ISqlTypeFactoryWithLength | sql.ISqlType
  value: unknown
}

export type SqlParams = Record<string, SqlParam>

/**
 * Runs one parameterised statement. `text` must be a constant T-SQL string using @name
 * placeholders; values travel only via `params` (never concatenated into the text).
 * Throws DatabaseUnavailableError for 40613; other errors propagate unchanged.
 */
export async function query<T = Record<string, unknown>>(
  text: string,
  params: SqlParams = {},
): Promise<sql.IResult<T>> {
  try {
    const pool = await getPool()
    const request = pool.request()
    for (const [name, p] of Object.entries(params)) {
      request.input(name, p.type as sql.ISqlType, p.value)
    }
    return await request.query<T>(text)
  } catch (err) {
    if (isDatabaseUnavailable(err)) throw new DatabaseUnavailableError()
    throw err
  }
}

export { sql }
