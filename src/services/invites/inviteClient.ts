import type { CreateInviteRequest, CreateInviteResponse } from '../../types/api'
import { apiPost } from '../auth/apiClient'

export type RequestInviteResult =
  | { kind: 'ok' }
  | { kind: 'rate-limited' }
  | { kind: 'invalid'; message: string }
  | { kind: 'database-waking' }
  | { kind: 'error'; message: string }

/** Submit an access/invite request (POST /api/invite-requests). Never throws. */
export async function requestInvite(body: CreateInviteRequest): Promise<RequestInviteResult> {
  const result = await apiPost<CreateInviteResponse>('/api/invite-requests', body)
  switch (result.kind) {
    case 'success':
      return { kind: 'ok' }
    case 'database-waking':
      return { kind: 'database-waking' }
    case 'validation-failure':
      return { kind: 'invalid', message: result.error }
    case 'auth-failure':
    case 'error':
      if (result.status === 429 || result.code === 'RATE_LIMITED') return { kind: 'rate-limited' }
      return { kind: 'error', message: result.error }
  }
}
