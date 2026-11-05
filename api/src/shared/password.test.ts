import { describe, expect, it, vi } from 'vitest'

const tseSpy = vi.hoisted(() => vi.fn())
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  tseSpy.mockImplementation((a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => actual.timingSafeEqual(a, b))
  return { ...actual, default: actual, timingSafeEqual: tseSpy }
})

const { hash, verify, verifyAgainstDummy } = await import('./password')

describe('password', () => {
  it('round-trips, uses per-user salt, rejects wrong password, and compares in constant time', async () => {
    tseSpy.mockClear()
    const h1 = await hash('correct horse battery')
    const h2 = await hash('correct horse battery')
    expect(h1).not.toBe(h2)
    expect(h1).toMatch(/^scrypt\$131072\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
    expect(h1.length).toBeLessThanOrEqual(255)
    expect(await verify('correct horse battery', h1)).toBe(true)
    expect(await verify('wrong password here', h1)).toBe(false)
    // Both the matching and the non-matching verification went through timingSafeEqual.
    expect(tseSpy).toHaveBeenCalledTimes(2)
  })

  it('rejects malformed stored values without throwing', async () => {
    expect(await verify('x', 'not-a-hash')).toBe(false)
    expect(await verify('x', 'md5$1$2$3$aa$bb')).toBe(false)
  })

  it('honours parameters encoded in the stored string', async () => {
    const h = await hash('pw-for-params-test')
    const lowered = h.replace('$131072$', '$16384$')
    expect(await verify('pw-for-params-test', lowered)).toBe(false) // different N => different digest
    expect(await verify('pw-for-params-test', h)).toBe(true)
  })

  it('verifyAgainstDummy always returns false', async () => {
    expect(await verifyAgainstDummy('anything')).toBe(false)
  })
})
