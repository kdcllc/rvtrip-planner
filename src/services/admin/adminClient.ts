import type {
  AdminInviteRequest,
  InviteActionResponse,
  ListInviteRequestsResponse,
} from '../../types/api'
import type { ApiResult } from '../../types/auth'
import { apiGet, apiPost } from '../auth/apiClient'

type AdminFailure =
  | { kind: 'forbidden' }
  | { kind: 'session-expired' }
  | { kind: 'email-failed'; message: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'database-waking' }
  | { kind: 'error'; message: string }

export type ListInviteRequestsResult =
  | { kind: 'ok'; requests: AdminInviteRequest[] }
  | AdminFailure

export type InviteActionResult = { kind: 'ok'; request: AdminInviteRequest } | AdminFailure

const toFailure = (result: Exclude<ApiResult<unknown>, { kind: 'success' }>): AdminFailure => {
  switch (result.kind) {
    case 'database-waking':
      return { kind: 'database-waking' }
    case 'auth-failure':
      return result.status === 403 ? { kind: 'forbidden' } : { kind: 'session-expired' }
    case 'validation-failure':
      return result.status === 409
        ? { kind: 'conflict', message: result.error }
        : { kind: 'error', message: result.error }
    case 'error':
      return result.status === 502 || result.code === 'EMAIL_FAILED'
        ? { kind: 'email-failed', message: result.error }
        : { kind: 'error', message: result.error }
  }
}

/** List invite requests (GET /api/admin/invite-requests). */
export async function listInviteRequests(): Promise<ListInviteRequestsResult> {
  const result = await apiGet<ListInviteRequestsResponse>('/api/admin/invite-requests')
  if (result.kind !== 'success') return toFailure(result)
  if (!result.data || !Array.isArray(result.data.requests)) {
    return { kind: 'error', message: 'Invalid response' }
  }
  return { kind: 'ok', requests: result.data.requests }
}

const act = async (id: string, action: 'invite' | 'decline'): Promise<InviteActionResult> => {
  const result = await apiPost<InviteActionResponse>(
    `/api/admin/invite-requests/${encodeURIComponent(id)}/${action}`,
    {}
  )
  return result.kind === 'success' ? { kind: 'ok', request: result.data.request } : toFailure(result)
}

/** Send (or resend) an invite email for a request. */
export const sendInvite = (id: string): Promise<InviteActionResult> => act(id, 'invite')

/** Decline a request. */
export const declineInvite = (id: string): Promise<InviteActionResult> => act(id, 'decline')
