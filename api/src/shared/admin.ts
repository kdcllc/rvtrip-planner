// Admin identity (ADMIN_EMAILS) and the admin-only request guard.
import type { HttpResponseInit } from '@azure/functions'
import { getAdminEmails } from './config'
import { error } from './http'
import type { RequestLike } from './http'
import { validateSession } from './session'
import type { ApiUser } from './types'

/** Case-insensitive membership test against ADMIN_EMAILS. */
export function isAdminEmail(email: string): boolean {
  return getAdminEmails().includes(email.trim().toLowerCase())
}

/** Returns the admin user, or a ready 401 (no session) / 403 (not an admin) response. */
export async function requireAdmin(req: RequestLike): Promise<ApiUser | HttpResponseInit> {
  const user = await validateSession(req)
  if (!user) return error(401, 'Unauthorized')
  if (!user.isAdmin) return error(403, 'Forbidden')
  return user
}
