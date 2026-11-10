// App emails (password reset, invite, access request) via Azure Communication Services (custom sender domain).
// ACS send limits apply per subscription, so a 429 is
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

const ACCENT = '#1d4ed8'
const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

type EmailContent = {
  heading: string
  paragraphs: string[]
  cta?: { label: string; url: string }
  footerNote: string
}

/** Renders the branded layout; returns an HTML body (inline styles only) and its plain-text twin. */
function renderEmail({ heading, paragraphs, cta, footerNote }: EmailContent): { html: string; plainText: string } {
  const site = baseUrl()
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#1f2937;">${escapeHtml(p)}</p>`)
    .join('')
  const button = cta
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:12px 24px;background:${ACCENT};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">${escapeHtml(cta.label)}</a></p>` +
      `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#6b7280;">If the button does not work, copy this link into your browser:<br>${escapeHtml(cta.url)}</p>`
    : ''
  const title = `${heading} \u2014 RV Trip Planner`
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f3f4f6;font-family:${FONT};">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;">` +
    `<tr><td style="padding:20px 32px;background:${ACCENT};border-radius:8px 8px 0 0;font-size:20px;font-weight:700;color:#ffffff;">RV Trip Planner</td></tr>` +
    `<tr><td style="padding:32px;"><h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#111827;">${escapeHtml(heading)}</h1>${body}${button}</td></tr>` +
    `<tr><td style="padding:20px 32px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#6b7280;">${escapeHtml(footerNote)}<br><a href="${escapeHtml(site)}" style="color:${ACCENT};">${escapeHtml(site)}</a></td></tr>` +
    `</table></td></tr></table></body></html>`
  const plainText = [
    'RV Trip Planner',
    heading,
    ...paragraphs,
    ...(cta ? [`${cta.label}:`, cta.url] : []),
    `${footerNote}\n${site}`,
  ].join('\n\n')
  return { html, plainText }
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

/** Sends the reset email. Never throws for ACS failures: 429/5xx are retryable, others not. */
export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<SendResult> {
  try {
    const { html, plainText } = renderEmail({
      heading: 'Reset your password',
      paragraphs: ['We received a request to reset your RV Trip Planner password. Use the button below to choose a new one. The link is valid for 1 hour.'],
      cta: { label: 'Reset password', url: resetLink },
      footerNote: 'You received this email because a password reset was requested for your account. If you did not request this, you can safely ignore this email.',
    })
    return await send(to, 'Reset your RV Trip Planner password', plainText, html)
  } catch {
    return { ok: false, retryable: false }
  }
}

/** Notifies an admin of a new access request. Never throws for ACS failures. */
export async function sendInviteRequestNotification(
  to: string,
  req: { name: string; email: string; note: string | null | undefined },
): Promise<SendResult> {
  const { html, plainText } = renderEmail({
    heading: 'New access request',
    paragraphs: [`Name: ${req.name}`, `Email: ${req.email}`, `Note: ${req.note || '(none)'}`, 'Review the request and send an invitation from the admin page.'],
    cta: { label: 'Open admin page', url: baseUrl() },
    footerNote: 'You received this email because you are an administrator of RV Trip Planner.',
  })
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
  const { html, plainText } = renderEmail({
    heading: `Hi ${name}, you're invited`,
    paragraphs: [`You're invited to RV Trip Planner. Use the button below to create your account. The invitation expires on ${expiry}.`],
    cta: { label: 'Create your account', url: inviteLink },
    footerNote: 'You received this email because an administrator invited you to RV Trip Planner.',
  })
  return send(to, 'Your invitation to RV Trip Planner', plainText, html)
}
