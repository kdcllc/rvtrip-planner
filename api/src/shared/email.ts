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
