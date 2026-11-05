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

import { buildResetLink, sendPasswordResetEmail } from './email'

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
