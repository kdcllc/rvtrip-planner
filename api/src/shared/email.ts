// Password-reset email via Azure Communication Services (managed domain).
// ACS managed-domain limits: 5 emails/minute, 10/hour per subscription (unraisable), so a 429 is
// expected under load and is returned as a retryable result, never thrown.
// This module never logs the recipient, the reset link/token or the connection string.
import { EmailClient } from '@azure/communication-email'
import { requireSetting } from './config'

export type SendResult = { ok: true } | { ok: false; retryable: boolean }

function statusOf(err: unknown): number | undefined {
  const s = (err as { statusCode?: unknown } | null)?.statusCode
  return typeof s === 'number' ? s : undefined
}

/** Builds the reset link from APP_BASE_URL; the token is URL-encoded. */
export function buildResetLink(token: string): string {
  const base = requireSetting('APP_BASE_URL').replace(/\/+$/, '')
  return `${base}/reset-password?token=${encodeURIComponent(token)}`
}

/** Sends the reset email. Never throws for ACS failures: 429/5xx are retryable, others not. */
export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<SendResult> {
  try {
    const client = new EmailClient(requireSetting('ACS_CONNECTION_STRING'))
    await client.beginSend({
      senderAddress: requireSetting('ACS_SENDER_ADDRESS'),
      recipients: { to: [{ address: to }] },
      content: {
        subject: 'Reset your password',
        plainText: `Use this link to reset your password (valid for 1 hour):\n\n${resetLink}\n\nIf you did not request this, ignore this email.`,
      },
    })
    return { ok: true }
  } catch (err) {
    const status = statusOf(err)
    return { ok: false, retryable: status === 429 || (status !== undefined && status >= 500) }
  }
}

function baseUrl(): string {
  return requireSetting('APP_BASE_URL').replace(/\/+$/, '')
}

/** Builds the sign-up link carrying the invite code; the code is URL-encoded. */
export function buildInviteLink(code: string): string {
  return `${baseUrl()}/?invite=${encodeURIComponent(code)}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function send(to: string, subject: string, plainText: string, html?: string): Promise<SendResult> {
  try {
    const client = new EmailClient(requireSetting('ACS_CONNECTION_STRING'))
    await client.beginSend({
      senderAddress: requireSetting('ACS_SENDER_ADDRESS'),
      recipients: { to: [{ address: to }] },
      content: html ? { subject, plainText, html } : { subject, plainText },
    })
    return { ok: true }
  } catch (err) {
    const status = statusOf(err)
    return { ok: false, retryable: status === 429 || (status !== undefined && status >= 500) }
  }
}

/** Notifies an admin of a new access request. Never throws for ACS failures. */
export async function sendInviteRequestNotification(
  to: string,
  req: { name: string; email: string; note: string | null | undefined },
): Promise<SendResult> {
  const note = req.note ?? ''
  const base = baseUrl()
  const plainText = `New access request for RV Trip Planner.\n\nName: ${req.name}\nEmail: ${req.email}\nNote: ${note || '(none)'}\n\nReview and send an invitation from the admin page: ${base}`
  const html = `<p>New access request for RV Trip Planner.</p><ul><li><strong>Name:</strong> ${escapeHtml(req.name)}</li><li><strong>Email:</strong> ${escapeHtml(req.email)}</li><li><strong>Note:</strong> ${note ? escapeHtml(note) : '(none)'}</li></ul><p>Review and send an invitation from the admin page: <a href="${escapeHtml(base)}">${escapeHtml(base)}</a></p>`
  return send(to, 'New access request \u2014 RV Trip Planner', plainText, html)
}

/** Sends the invitation with the sign-up link and its expiry date. Never throws for ACS failures. */
export async function sendInviteEmail(
  to: string,
  name: string,
  inviteLink: string,
  expiresAt: Date,
): Promise<SendResult> {
  const expiry = expiresAt.toISOString().slice(0, 10)
  const plainText = `Hi ${name},\n\nYou're invited to RV Trip Planner. Use this link to create your account:\n\n${inviteLink}\n\nThe invitation expires on ${expiry}.`
  const html = `<p>Hi ${escapeHtml(name)},</p><p>You're invited to RV Trip Planner. Use this link to create your account:</p><p><a href="${escapeHtml(inviteLink)}">${escapeHtml(inviteLink)}</a></p><p>The invitation expires on ${escapeHtml(expiry)}.</p>`
  return send(to, 'Your invitation to RV Trip Planner', plainText, html)
}
