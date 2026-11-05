import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const ctor = vi.fn()
  const inputs: Array<[string, unknown]> = []
  const request = {
    input: vi.fn((n: string, _t: unknown, v: unknown) => {
      inputs.push([n, v])
      return request
    }),
    query: vi.fn(async () => ({ recordset: [] })),
  }
  return { ctor, inputs, request }
})

vi.mock('mssql', () => {
  class ConnectionPool {
    constructor(cfg: unknown) {
      h.ctor(cfg)
    }
    connect() {
      return Promise.resolve(this)
    }
    request() {
      return h.request
    }
    static parseConnectionString() {
      return { server: 'x', database: 'y' }
    }
  }
  const t = () => ({})
  return { default: { ConnectionPool, NVarChar: t, UniqueIdentifier: {}, DateTimeOffset: {} } }
})

import { DatabaseUnavailableError, isDatabaseUnavailable, POOL_OPTIONS, query } from './db'

const ELOGIN_40613 = {
  name: 'ConnectionError',
  code: 'ELOGIN',
  message: "Database 'x' on server 'y' is not currently available. Please retry the connection later.",
}
const ELOGIN_BAD_USER = { name: 'ConnectionError', code: 'ELOGIN', message: "Login failed for user 'sa'." }

beforeEach(() => {
  process.env.SQL_CONNECTION_STRING = 'Server=test'
})

describe('db pool', () => {
  it('is configured with min 0 and a short idle timeout', () => {
    expect(POOL_OPTIONS.min).toBe(0)
    expect(POOL_OPTIONS.idleTimeoutMillis).toBeLessThanOrEqual(30000)
  })

  it('creates the pool once with min 0 and reuses it, binding parameters', async () => {
    await query('SELECT @a', { a: { type: {} as never, value: 1 } })
    await query('SELECT 1')
    expect(h.ctor).toHaveBeenCalledTimes(1)
    expect(h.ctor.mock.calls[0][0].pool.min).toBe(0)
    expect(h.inputs).toEqual([['a', 1]])
  })

  it('maps error 40613 to DatabaseUnavailableError without retrying', async () => {
    h.request.query.mockClear()
    h.request.query.mockRejectedValueOnce({ number: 40613 })
    await expect(query('SELECT 1')).rejects.toBeInstanceOf(DatabaseUnavailableError)
    expect(h.request.query).toHaveBeenCalledTimes(1)
  })
})

describe('query login-phase 40613', () => {
  it('maps a number-less ELOGIN unavailable error to DatabaseUnavailableError', async () => {
    h.request.query.mockRejectedValueOnce(ELOGIN_40613)
    await expect(query('SELECT 1')).rejects.toBeInstanceOf(DatabaseUnavailableError)
  })
})

describe('isDatabaseUnavailable', () => {
  it('recognises 40613 only', () => {
    expect(isDatabaseUnavailable({ number: 40613 })).toBe(true)
    expect(isDatabaseUnavailable({ originalError: { info: { number: 40613 } } })).toBe(true)
    expect(isDatabaseUnavailable({ number: 40614 })).toBe(false)
    expect(isDatabaseUnavailable({ number: 40197 })).toBe(false)
    expect(isDatabaseUnavailable(new Error('x'))).toBe(false)
    expect(isDatabaseUnavailable(ELOGIN_40613)).toBe(true)
    expect(isDatabaseUnavailable({ originalError: ELOGIN_40613 })).toBe(true)
    expect(isDatabaseUnavailable(ELOGIN_BAD_USER)).toBe(false)
    expect(isDatabaseUnavailable(null)).toBe(false)
  })

  it('maps connect-phase ETIMEOUT ConnectionError (top-level or originalError) to unavailable', () => {
    expect(isDatabaseUnavailable({ name: 'ConnectionError', code: 'ETIMEOUT', message: 'Failed to connect' })).toBe(true)
    expect(
      isDatabaseUnavailable({ name: 'ConnectionError', message: 'x', originalError: { code: 'ETIMEOUT' } }),
    ).toBe(true)
  })

  it('does not map query-phase timeouts or other connection failures', () => {
    expect(isDatabaseUnavailable({ name: 'RequestError', code: 'ETIMEOUT', message: 'Timeout' })).toBe(false)
    expect(isDatabaseUnavailable({ name: 'RequestError', code: 'ETIMEOUT', originalError: { code: 'ETIMEOUT' } })).toBe(false)
    expect(isDatabaseUnavailable({ name: 'ConnectionError', code: 'ESOCKET' })).toBe(false)
    expect(isDatabaseUnavailable({ name: 'ConnectionError', code: 'ECONNCLOSED' })).toBe(false)
    expect(isDatabaseUnavailable(ELOGIN_BAD_USER)).toBe(false)
  })
})

describe('query connect timeout', () => {
  it('maps ETIMEOUT ConnectionError to DatabaseUnavailableError without retrying', async () => {
    h.request.query.mockClear()
    h.request.query.mockRejectedValueOnce({ name: 'ConnectionError', code: 'ETIMEOUT' })
    await expect(query('SELECT 1')).rejects.toBeInstanceOf(DatabaseUnavailableError)
    expect(h.request.query).toHaveBeenCalledTimes(1)
  })
})
