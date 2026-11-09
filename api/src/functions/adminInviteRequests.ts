// Admin access-request management: list, send/resend invite, decline.
// Plain invite codes only ever travel to the email link; they are never stored or logged.
import { app } from '@azure/functions'
import type { HttpRequest, HttpResponseInit } from '@azure/functions'
import { requireAdmin } from '../shared/admin'
import { query, sql } from '../shared/db'
import { buildInviteLink, sendInviteEmail } from '../shared/email'
import { csrfGuard, error, fromException, json } from '../shared/http'
import { issueInviteCode, revokeInviteCode, revokeUnusedInviteCodes } from '../shared/inviteCodes'
import type { AdminInviteRequest, InviteActionResponse, InviteRequestStatus, ListInviteRequestsResponse } from '../shared/types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLUMNS = 'id, email, name, note, status, created_at, invited_at, invite_count'

type Row = {
  id: string
  email: string
  name: string
  note: string | null
  status: InviteRequestStatus
  created_at: Date | string
  invited_at: Date | string | null
  invite_count: number
}

const iso = (d: Date | string) => new Date(d).toISOString()

function toDto(r: Row): AdminInviteRequest {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    note: r.note ?? null,
    status: r.status,
    createdAt: iso(r.created_at),
    invitedAt: r.invited_at ? iso(r.invited_at) : null,
    inviteCount: r.invite_count,
  }
}

async function findRequest(id: string): Promise<Row | undefined> {
  const res = await query<Row>(`SELECT ${COLUMNS} FROM dbo.invite_requests WHERE id = @id`, {
    id: { type: sql.UniqueIdentifier, value: id },
  })
  return res.recordset[0]
}

export async function listInviteRequests(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const admin = await requireAdmin(req)
    if ('status' in admin) return admin
    const res = await query<Row>(`SELECT ${COLUMNS} FROM dbo.invite_requests ORDER BY created_at DESC`)
    return json<ListInviteRequestsResponse>({ requests: res.recordset.map(toDto) })
  } catch (err) {
    return fromException(err)
  }
}

export async function sendInvite(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const denied = csrfGuard(req)
    if (denied) return denied
    const admin = await requireAdmin(req)
    if ('status' in admin) return admin

    const id = req.params?.id
    if (!id || !UUID_PATTERN.test(id)) return error(400, 'Invalid request id')
    const row = await findRequest(id)
    if (!row) return error(404, 'Request not found')
    if (row.status === 'registered') return error(409, 'Already registered')

    const { code, expiresAt } = await issueInviteCode(id)
    const sent = await sendInviteEmail(row.email, row.name, buildInviteLink(code), expiresAt)
    if (!sent.ok) {
      await revokeInviteCode(code)
      return error(502, 'Email could not be sent', 'EMAIL_FAILED')
    }

    const updated = await query<Row>(
      `UPDATE dbo.invite_requests
          SET status = 'invited', invited_at = SYSUTCDATETIME(), invite_count = invite_count + 1
        OUTPUT inserted.id, inserted.email, inserted.name, inserted.note, inserted.status,
               inserted.created_at, inserted.invited_at, inserted.invite_count
        WHERE id = @id`,
      { id: { type: sql.UniqueIdentifier, value: id } },
    )
    const next = updated.recordset[0]
    if (!next) return error(404, 'Request not found')
    return json<InviteActionResponse>({ request: toDto(next) })
  } catch (err) {
    return fromException(err)
  }
}

export async function declineInvite(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const denied = csrfGuard(req)
    if (denied) return denied
    const admin = await requireAdmin(req)
    if ('status' in admin) return admin

    const id = req.params?.id
    if (!id || !UUID_PATTERN.test(id)) return error(400, 'Invalid request id')
    const row = await findRequest(id)
    if (!row) return error(404, 'Request not found')
    if (row.status === 'registered') return error(409, 'Already registered')

    await revokeUnusedInviteCodes(id)
    const updated = await query<Row>(
      `UPDATE dbo.invite_requests SET status = 'declined'
        OUTPUT inserted.id, inserted.email, inserted.name, inserted.note, inserted.status,
               inserted.created_at, inserted.invited_at, inserted.invite_count
        WHERE id = @id AND status <> 'registered'`,
      { id: { type: sql.UniqueIdentifier, value: id } },
    )
    const next = updated.recordset[0]
    if (!next) return error(409, 'Already registered')
    return json<InviteActionResponse>({ request: toDto(next) })
  } catch (err) {
    return fromException(err)
  }
}

// Routes live under /api/manage, not /api/admin: the deployed Functions host behind Static Web Apps
// answers every /api/admin* request with 404 before it reaches the function (observed live 2026-11-09).
app.http('adminListInviteRequests', {
  route: 'manage/invite-requests',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: listInviteRequests,
})
app.http('adminSendInvite', {
  route: 'manage/invite-requests/{id}/invite',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: sendInvite,
})
app.http('adminDeclineInvite', {
  route: 'manage/invite-requests/{id}/decline',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: declineInvite,
})
