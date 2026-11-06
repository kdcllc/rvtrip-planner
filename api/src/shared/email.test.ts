import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ beginSend: vi.fn(), ctor: vi.fn() }))
vi.mock('@azure/communication-email', () => ({
  EmailClient: class {
    constructor(cs: string) {
      h.ctor(cs)
    }
    beginSend = h.beginSend
  },
}))

import {
  buildInviteLink,
  buildResetLink,
  sendInviteEmail,
  sendInviteRequestNotification,
  sendPasswordResetEmail,
} from './email'

process.env.ACS_CONNECTION_STRING = 'endpoint=https://x/;accesskey=k'
process.env.ACS_SENDER_ADDRESS = 'DoNotReply@managed.example'
process.env.APP_BASE_URL = 'https://app.example.com/'

beforeEach(() => {
  h.beginSend.mockReset()
  h.ctor.mockReset()
})

describe('email sender', () => {
  it('sends from the configured sender using the configured connection string', async () => {
    h.beginSend.mockResolvedValue({})
    const r = await sendPasswordResetEmail('a@b.co', 'https://l')
    expect(r).toEqual({ ok: true })
    expect(h.ctor).toHaveBeenCalledWith('endpoint=https://x/;accesskey=k')
    const msg = h.beginSend.mock.calls[0][0]
    expect(msg.senderAddress).toBe('DoNotReply@managed.example')
    expect(msg.recipients.to[0].address).toBe('a@b.co')
    expect(msg.content.plainText).toContain('https://l')
  })

  it('429 is returned as retryable, not thrown', async () => {
    h.beginSend.mockRejectedValue(Object.assign(new Error('Too many'), { statusCode: 429 }))
    expect(await sendPasswordResetEmail('a@b.co', 'l')).toEqual({ ok: false, retryable: true })
  })

  it('other failures are non-retryable and not thrown', async () => {
    h.beginSend.mockRejectedValue(Object.assign(new Error('bad'), { statusCode: 400 }))
    expect(await sendPasswordResetEmail('a@b.co', 'l')).toEqual({ ok: false, retryable: false })
    h.beginSend.mockRejectedValue(new Error('network'))
    expect(await sendPasswordResetEmail('a@b.co', 'l')).toEqual({ ok: false, retryable: false })
  })

  it('builds the link from APP_BASE_URL with an encoded token', () => {
    expect(buildResetLink('a+b/c')).toBe('https://app.example.com/reset-password?token=a%2Bb%2Fc')
  })
})

describe('invite emails', () => {
  it('builds the invite link with an encoded code', () => {
    expect(buildInviteLink('a+b/c')).toBe('https://app.example.com/?invite=a%2Bb%2Fc')
  })

  it('notification has the fixed subject, details and admin hint; HTML-escapes user values', async () => {
    h.beginSend.mockResolvedValue({})
    const r = await sendInviteRequestNotification('admin@x.co', {
      name: '<script>alert(1)</script>',
      email: 'v@x.co',
      note: '<script>n</script>',
    })
    expect(r).toEqual({ ok: true })
    const c = h.beginSend.mock.calls[0][0].content
    expect(c.subject).toBe('New access request \u2014 RV Trip Planner')
    expect(c.plainText).toContain('v@x.co')
    expect(c.plainText).toContain('https://app.example.com')
    expect(c.html).not.toContain('<script>')
    expect(c.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(c.html).toContain('&lt;script&gt;n&lt;/script&gt;')
  })

  it('notification tolerates a null note and maps failures without throwing', async () => {
    h.beginSend.mockRejectedValue(Object.assign(new Error('x'), { statusCode: 503 }))
    expect(await sendInviteRequestNotification('a@x.co', { name: 'N', email: 'e@x.co', note: null })).toEqual({
      ok: false,
      retryable: true,
    })
  })

  it('invite email greets by name, includes link and expiry in text and HTML, escapes name', async () => {
    h.beginSend.mockResolvedValue({})
    const r = await sendInviteEmail('v@x.co', '<b>Bob</b>', 'https://app.example.com/?invite=a&b', new Date('2026-12-01T10:00:00Z'))
    expect(r).toEqual({ ok: true })
    const msg = h.beginSend.mock.calls[0][0]
    expect(msg.recipients.to[0].address).toBe('v@x.co')
    expect(msg.content.subject).toBe('Your invitation to RV Trip Planner')
    expect(msg.content.plainText).toContain('https://app.example.com/?invite=a&b')
    expect(msg.content.plainText).toContain('2026-12-01')
    expect(msg.content.html).toContain('&lt;b&gt;Bob&lt;/b&gt;')
    expect(msg.content.html).toContain('invite=a&amp;b')
    expect(msg.content.html).toContain('2026-12-01')
  })

  it('invite email 429 is retryable, other failures not', async () => {
    h.beginSend.mockRejectedValue(Object.assign(new Error('x'), { statusCode: 429 }))
    expect(await sendInviteEmail('a@b.co', 'N', 'l', new Date())).toEqual({ ok: false, retryable: true })
    h.beginSend.mockRejectedValue(new Error('net'))
    expect(await sendInviteEmail('a@b.co', 'N', 'l', new Date())).toEqual({ ok: false, retryable: false })
  })
})
