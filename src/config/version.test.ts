import { describe, expect, it } from 'vitest'
import { APP_VERSION, formatVersionLabel } from './version'

describe('version config', () => {
  it('formats the label as v<version> (<commit>)', () => {
    expect(formatVersionLabel({ version: '1.2.3', commit: 'abc1234', buildTime: 'x' })).toBe(
      'v1.2.3 (abc1234)',
    )
  })

  it('ignores buildTime in the label', () => {
    const a = formatVersionLabel({ version: '1', commit: 'c', buildTime: 'a' })
    const b = formatVersionLabel({ version: '1', commit: 'c', buildTime: 'b' })
    expect(a).toBe(b)
  })

  it('APP_VERSION equals the vitest-defined values', () => {
    expect(APP_VERSION).toEqual({
      version: '0.0.0-test',
      commit: 'testsha',
      buildTime: '1970-01-01T00:00:00.000Z',
    })
    expect(formatVersionLabel(APP_VERSION)).toBe('v0.0.0-test (testsha)')
  })
})
