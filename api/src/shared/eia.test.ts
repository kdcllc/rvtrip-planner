import { describe, expect, it, vi } from 'vitest'
import { EIA_ALLOWED_AREAS, EIA_ALLOWED_PRODUCTS, fetchEiaLatest, fetchEiaWeekly } from './eia'

const KEY = 'secret-key-123'

function stub(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => {
      if (body instanceof Error) throw body
      return body
    },
  })) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

const urlOf = (f: ReturnType<typeof vi.fn>) => new URL(String(f.mock.calls[0][0]))

describe('constants', () => {
  it('lists the allowed areas and products', () => {
    expect(EIA_ALLOWED_AREAS).toContain('NUS')
    expect(EIA_ALLOWED_AREAS).toContain('R5XCA')
    expect(EIA_ALLOWED_PRODUCTS).toEqual(['EPMR', 'EPD2D'])
  })
})

describe('fetchEiaWeekly', () => {
  it('calls the EIA endpoint with every parameter', async () => {
    const f = stub({ response: { data: [] } })
    await fetchEiaWeekly(KEY, 'SCA', 'EPMR', '2026-01-05', '2026-03-02', f)
    const u = urlOf(f)
    expect(u.host).toBe('api.eia.gov')
    expect(u.pathname).toBe('/v2/petroleum/pri/gnd/data/')
    const p = u.searchParams
    expect(p.get('api_key')).toBe(KEY)
    expect(p.get('frequency')).toBe('weekly')
    expect(p.get('data[0]')).toBe('value')
    expect(p.get('facets[duoarea][]')).toBe('SCA')
    expect(p.get('facets[product][]')).toBe('EPMR')
    expect(p.get('start')).toBe('2026-01-05')
    expect(p.get('end')).toBe('2026-03-02')
    expect(p.get('sort[0][column]')).toBe('period')
    expect(p.get('sort[0][direction]')).toBe('asc')
    expect(p.get('length')).toBe('5000')
    expect(f.mock.calls[0][1]).toHaveProperty('signal')
  })

  it('maps rows and skips bad values', async () => {
    const f = stub({
      response: {
        data: [
          { period: '2026-01-05', value: '3.123' },
          { period: '2026-01-12', value: 3.5 },
          { period: '2026-01-19', value: null },
          { period: '2026-01-26', value: 'abc' },
          { period: '2026-02-02', value: '0' },
          { period: '2026-02-09', value: '-1' },
        ],
      },
    })
    expect(await fetchEiaWeekly(KEY, 'NUS', 'EPMR', 'a', 'b', f)).toEqual([
      { week: '2026-01-05', price: 3.123 },
      { week: '2026-01-12', price: 3.5 },
    ])
  })

  it('throws without the key on a non-2xx response', async () => {
    const err = await fetchEiaWeekly(KEY, 'NUS', 'EPMR', 'a', 'b', stub({}, { ok: false, status: 500 })).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).not.toContain(KEY)
  })

  it('throws without the key on malformed JSON or shape', async () => {
    for (const f of [stub(new Error(`bad ${KEY}`)), stub({ nope: 1 })]) {
      const err = await fetchEiaWeekly(KEY, 'NUS', 'EPMR', 'a', 'b', f).catch((e) => e)
      expect(err).toBeInstanceOf(Error)
      expect(err.message).not.toContain(KEY)
    }
  })

  it('throws without the key when the network rejects', async () => {
    const f = vi.fn(async () => {
      throw new TypeError(`fetch failed https://api.eia.gov/?api_key=${KEY}`)
    }) as unknown as typeof fetch
    const err = await fetchEiaWeekly(KEY, 'NUS', 'EPMR', 'a', 'b', f).catch((e) => e)
    expect(err.message).not.toContain(KEY)
  })
})

describe('fetchEiaLatest', () => {
  it('requests the newest single row without a range', async () => {
    const f = stub({ response: { data: [{ period: '2026-11-23', value: '3.2' }] } })
    expect(await fetchEiaLatest(KEY, 'R30', 'EPD2D', f)).toEqual({ week: '2026-11-23', price: 3.2 })
    const p = urlOf(f).searchParams
    expect(p.get('api_key')).toBe(KEY)
    expect(p.get('start')).toBeNull()
    expect(p.get('end')).toBeNull()
    expect(p.get('sort[0][direction]')).toBe('desc')
    expect(p.get('length')).toBe('1')
  })

  it('returns null when there is no usable row', async () => {
    expect(await fetchEiaLatest(KEY, 'NUS', 'EPMR', stub({ response: { data: [] } }))).toBeNull()
  })
})
