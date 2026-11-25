// Application settings, read from process.env (the six app settings provisioned by infra).
// Values are secrets in several cases: this module never logs, echoes or serialises them,
// and error messages name only the missing VARIABLE, never a value.

export const SETTING_NAMES = [
  'SQL_CONNECTION_STRING',
  'SESSION_SECRET',
  'ACS_CONNECTION_STRING',
  'ACS_SENDER_ADDRESS',
  'APP_BASE_URL',
  'INVITE_CODE',
] as const

export type SettingName = (typeof SETTING_NAMES)[number]

/** Returns one required setting or throws an error naming the missing variable. */
export function requireSetting(name: SettingName): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

/** Optional ADMIN_EMAILS (comma/semicolon separated): trimmed, lowercased, empties dropped; [] when unset. */
export function getAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS
  if (!raw) return []
  return raw
    .split(/[,;]/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== '')
}
