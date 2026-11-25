import { describe, expect, it, vi } from 'vitest'
import { fetchDeployedVersion, isNewVersion } from './versionCheck'

const info = { version: '1.0.0', commit: 'aaa', buildTime: '2026-01-01T00:00:00Z' }

const okResponse = (body: unknown) =>
  ({ ok: true, json: () => Promise.resolve(body) }) as unknown as Response

describe('fetchDeployedVersion', () => {
  it('returns parsed info on 200', async () => {
    const f = vi.fn().mockResolvedValue(okResponse(info))
    expect(await fetchDeployedVersion(f)).toEqual(info)
  })

  it('requests /version.json with cache no-store', async () => {
    const f = vi.fn().mockResolvedValue(okResponse(info))
    await fetchDeployedVersion(f)
    expect(f).toHaveBeenCalledWith('/version.json', { cache: 'no-store' })
  })

  it('returns null on network rejection', async () => {
    const f = vi.fn().mockRejectedValue(new Error('offline'))
    expect(await fetchDeployedVersion(f)).toBeNull()
  })

  it('returns null on non-2xx', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve(info) })
    expect(await fetchDeployedVersion(f)).toBeNull()
  })

  it('returns null on invalid JSON', async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError('bad')),
    })
    expect(await fetchDeployedVersion(f)).toBeNull()
  })

  it.each(['version', 'commit', 'buildTime'])('returns null when %s is missing', async (field) => {
    const body: Record<string, string> = { ...info }
    delete body[field]
    const f = vi.fn().mockResolvedValue(okResponse(body))
    expect(await fetchDeployedVersion(f)).toBeNull()
  })

  it('returns null for non-object payloads', async () => {
    expect(await fetchDeployedVersion(vi.fn().mockResolvedValue(okResponse(null)))).toBeNull()
    expect(await fetchDeployedVersion(vi.fn().mockResolvedValue(okResponse('str')))).toBeNull()
  })
})

describe('isNewVersion', () => {
  it('is true when version differs', () => {
    expect(isNewVersion(info, { ...info, version: '1.0.1' })).toBe(true)
  })
  it('is true when commit differs', () => {
    expect(isNewVersion(info, { ...info, commit: 'bbb' })).toBe(true)
  })
  it('is false when only buildTime differs', () => {
    expect(isNewVersion(info, { ...info, buildTime: '2027-01-01T00:00:00Z' })).toBe(false)
  })
  it('is false when identical', () => {
    expect(isNewVersion(info, { ...info })).toBe(false)
  })
})
