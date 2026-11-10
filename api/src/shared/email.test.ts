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
  sendTestEmail,
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
    expect(msg.content.subject).toBe('Reset your RV Trip Planner password')
    expect(msg.content.html).toBeTruthy()
    expect(msg.content.html).toContain('href="https://l"')
  })

  it('reset link with special characters is escaped in html and verbatim in plain text', async () => {
    h.beginSend.mockResolvedValue({})
    const link = 'https://app.example.com/reset-password?token=a&b'
    await sendPasswordResetEmail('a@b.co', link)
    const c = h.beginSend.mock.calls[0][0].content
    expect(c.plainText).toContain(link)
    expect(c.html).toContain('token=a&amp;b')
    expect(c.html).not.toContain('token=a&b')
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

describe('shared branded layout', () => {
  const SITE = 'https://app.example.com'
  const RESET = 'https://app.example.com/reset-password?token=t1'
  const INVITE = 'https://app.example.com/?invite=c1'

  const cases: { name: string; cta: string; send: () => Promise<unknown> }[] = [
    { name: 'password reset', cta: RESET, send: () => sendPasswordResetEmail('a@b.co', RESET) },
    {
      name: 'access request',
      cta: SITE,
      send: () => sendInviteRequestNotification('admin@x.co', { name: 'N', email: 'e@x.co', note: 'hi' }),
    },
    {
      name: 'invite',
      cta: INVITE,
      send: () => sendInviteEmail('v@x.co', 'Bob', INVITE, new Date('2026-12-01T10:00:00Z')),
    },
  ]

  it.each(cases)('$name email has a branded, image/script-free HTML body and a plain-text twin', async ({ cta, send }) => {
    h.beginSend.mockResolvedValue({})
    expect(await send()).toEqual({ ok: true })
    const { html, plainText } = h.beginSend.mock.calls[0][0].content
    expect(html.trimStart().toLowerCase().startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('RV Trip Planner')
    expect(html).toContain(`<a href="${cta}"`)
    expect(html).toContain(`<a href="${SITE}"`)
    for (const tag of ['<img', '<script', '<style', '<link']) {
      expect(html.toLowerCase()).not.toContain(tag)
    }
    expect(plainText).toContain(cta)
    expect(plainText).toContain(SITE)
  })

  it('reset email states the 1 hour validity and footer reason in html and plain text', async () => {
    h.beginSend.mockResolvedValue({})
    await sendPasswordResetEmail('a@b.co', RESET)
    const { html, plainText } = h.beginSend.mock.calls[0][0].content
    for (const body of [html, plainText]) {
      expect(body).toContain('1 hour')
      expect(body).toContain('a password reset was requested for your account')
    }
  })

  it('invite email shows the expiry date and footer reason in html and plain text', async () => {
    h.beginSend.mockResolvedValue({})
    await sendInviteEmail('v@x.co', 'Bob', INVITE, new Date('2026-12-01T10:00:00Z'))
    const { html, plainText } = h.beginSend.mock.calls[0][0].content
    for (const body of [html, plainText]) {
      expect(body).toContain('2026-12-01')
      expect(body).toContain('an administrator invited you to RV Trip Planner')
    }
  })

  it('access request footer reason is present in html and plain text', async () => {
    h.beginSend.mockResolvedValue({})
    await sendInviteRequestNotification('admin@x.co', { name: 'N', email: 'e@x.co', note: null })
    const { html, plainText } = h.beginSend.mock.calls[0][0].content
    for (const body of [html, plainText]) {
      expect(body).toContain('you are an administrator of RV Trip Planner')
      expect(body).toContain('(none)')
    }
  })

  it('escapes invite name in heading and request name/email/note in the new layout', async () => {
    h.beginSend.mockResolvedValue({})
    await sendInviteEmail('v@x.co', '<i>Eve</i>', INVITE, new Date('2026-12-01T10:00:00Z'))
    let html: string = h.beginSend.mock.calls[0][0].content.html
    expect(html).toContain('&lt;i&gt;Eve&lt;/i&gt;')
    expect(html).not.toContain('<i>')
    h.beginSend.mockClear()
    await sendInviteRequestNotification('admin@x.co', { name: '<b>n</b>', email: 'a"b@x.co', note: '<u>note</u>' })
    html = h.beginSend.mock.calls[0][0].content.html
    expect(html).toContain('&lt;b&gt;n&lt;/b&gt;')
    expect(html).toContain('a&quot;b@x.co')
    expect(html).toContain('&lt;u&gt;note&lt;/u&gt;')
    expect(html).not.toContain('<u>')
  })
})

describe('sendTestEmail', () => {
  const SENT_AT = new Date('2026-11-09T22:28:00Z')

  it('sends the diagnostic subject to the recipient with sender, ISO time, CTA and footer in html and text', async () => {
    h.beginSend.mockResolvedValue({})
    expect(await sendTestEmail('admin@x.co', SENT_AT)).toEqual({ ok: true })
    const msg = h.beginSend.mock.calls[0][0]
    expect(msg.content.subject).toBe('RV Trip Planner test email')
    expect(msg.recipients.to[0].address).toBe('admin@x.co')
    expect(msg.senderAddress).toBe('DoNotReply@managed.example')
    const { html, plainText } = msg.content
    for (const body of [html, plainText]) {
      expect(body).toContain('DoNotReply@managed.example')
      expect(body).toContain('2026-11-09T22:28:00.000Z')
      expect(body).toContain('email delivery works')
      expect(body).toContain('You received this because an admin requested a test email.')
    }
    expect(html).toContain('href="https://app.example.com"')
    expect(plainText).toContain('https://app.example.com')
  })

  it('html contains no script, iframe, form or img tags', async () => {
    h.beginSend.mockResolvedValue({})
    await sendTestEmail('admin@x.co', SENT_AT)
    expect(h.beginSend.mock.calls[0][0].content.html).not.toMatch(/<(script|iframe|form|img|link)\b/i)
  })

  it('ACS failures come back as results, not exceptions', async () => {
    h.beginSend.mockRejectedValue(Object.assign(new Error('Too many'), { statusCode: 429 }))
    expect(await sendTestEmail('admin@x.co', SENT_AT)).toEqual({ ok: false, retryable: true })
    h.beginSend.mockRejectedValue(new Error('nope'))
    expect(await sendTestEmail('admin@x.co', SENT_AT)).toEqual({ ok: false, retryable: false })
  })

  it('throws when the sender setting is missing (render-time failure)', async () => {
    const saved = process.env.ACS_SENDER_ADDRESS
    delete process.env.ACS_SENDER_ADDRESS
    try {
      await expect(sendTestEmail('admin@x.co', SENT_AT)).rejects.toThrow(/ACS_SENDER_ADDRESS/)
      expect(h.beginSend).not.toHaveBeenCalled()
    } finally {
      process.env.ACS_SENDER_ADDRESS = saved
    }
  })
})
