import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAdminEmails, getConfig, SETTING_NAMES } from './config'

describe('getAdminEmails', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    delete process.env.ADMIN_EMAILS
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  it('returns [] when unset', () => {
    expect(getAdminEmails()).toEqual([])
  })

  it('normalises a single value', () => {
    process.env.ADMIN_EMAILS = ' Travel@KingDavidConsulting.com ,'
    expect(getAdminEmails()).toEqual(['travel@kingdavidconsulting.com'])
  })

  it('splits lists on comma and semicolon, dropping empties', () => {
    process.env.ADMIN_EMAILS = 'A@x.com; b@X.com ,, ;C@x.com'
    expect(getAdminEmails()).toEqual(['a@x.com', 'b@x.com', 'c@x.com'])
  })

  it('does not make getConfig throw when ADMIN_EMAILS is missing', () => {
    for (const n of SETTING_NAMES) process.env[n] = 'v'
    expect(() => getConfig()).not.toThrow()
    expect(SETTING_NAMES as readonly string[]).not.toContain('ADMIN_EMAILS')
  })
})
