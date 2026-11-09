import type {
  AdminInviteRequest,
  CreateAdminInvite,
  InviteActionResponse,
  InviteSentResponse,
  ListInviteRequestsResponse,
} from '../../types/api'
import type { ApiResult } from '../../types/auth'
import { apiGet, apiPost } from '../auth/apiClient'

type AdminFailure =
  | { kind: 'forbidden' }
  | { kind: 'session-expired' }
  | { kind: 'conflict'; message: string }
  | { kind: 'database-waking' }
  | { kind: 'error'; message: string }

export type ListInviteRequestsResult = { kind: 'ok'; requests: AdminInviteRequest[] } | AdminFailure

export type InviteActionResult = { kind: 'ok'; request: AdminInviteRequest } | AdminFailure

export type InviteSentResult =
  | {
      kind: 'sent'
      request: AdminInviteRequest
      inviteLink: string
      emailSent: boolean
    }
  | AdminFailure

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
      return { kind: 'error', message: result.error }
  }
}

/** List invite requests (GET /api/manage/invite-requests). */
export async function listInviteRequests(): Promise<ListInviteRequestsResult> {
  const result = await apiGet<ListInviteRequestsResponse>('/api/manage/invite-requests')
  if (result.kind !== 'success') return toFailure(result)
  if (!result.data || !Array.isArray(result.data.requests)) {
    return { kind: 'error', message: 'Invalid response' }
  }
  return { kind: 'ok', requests: result.data.requests }
}

const decline = async (id: string): Promise<InviteActionResult> => {
  const result = await apiPost<InviteActionResponse>(
    `/api/manage/invite-requests/${encodeURIComponent(id)}/decline`,
    {}
  )
  return result.kind === 'success'
    ? { kind: 'ok', request: result.data.request }
    : toFailure(result)
}

const toSent = (result: ApiResult<InviteSentResponse>): InviteSentResult => {
  if (result.kind !== 'success') return toFailure(result)
  const d = result.data
  if (
    !d ||
    typeof d.inviteLink !== 'string' ||
    typeof d.emailSent !== 'boolean' ||
    !d.request ||
    typeof d.request !== 'object'
  ) {
    return { kind: 'error', message: 'Invalid response' }
  }
  return {
    kind: 'sent',
    request: d.request,
    inviteLink: d.inviteLink,
    emailSent: d.emailSent,
  }
}

/** Create an invite for an email directly (POST /api/manage/invites). */
export async function createInvite(input: CreateAdminInvite): Promise<InviteSentResult> {
  const body: CreateAdminInvite = { email: input.email }
  if (input.name !== undefined) body.name = input.name
  return toSent(await apiPost<InviteSentResponse>('/api/manage/invites', body))
}

/** Send (or resend) an invite for a request. */
export const sendInvite = async (id: string): Promise<InviteSentResult> =>
  toSent(
    await apiPost<InviteSentResponse>(
      `/api/manage/invite-requests/${encodeURIComponent(id)}/invite`,
      {}
    )
  )

/** Decline a request. */
export const declineInvite = (id: string): Promise<InviteActionResult> => decline(id)
