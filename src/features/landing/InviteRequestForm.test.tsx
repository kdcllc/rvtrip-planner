import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestInviteResult } from '../../services/invites/inviteClient'

const requestInvite = vi.hoisted(() => vi.fn())
vi.mock('../../services/invites/inviteClient', () => ({ requestInvite }))

import { InviteRequestForm } from './InviteRequestForm'

const fill = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText('Name'), 'Ann')
  await user.type(screen.getByLabelText('Email'), 'ann@x.co')
}
const submit = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Request an invite' }))

beforeEach(() => requestInvite.mockReset())

describe('InviteRequestForm', () => {
  it('validates required fields and does not submit', async () => {
    const user = userEvent.setup()
    render(<InviteRequestForm />)
    await submit(user)
    expect(screen.getByText('Enter your name.')).toBeInTheDocument()
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-describedby', 'invite-name-error')
    expect(requestInvite).not.toHaveBeenCalled()
  })

  it('shows the note counter', async () => {
    const user = userEvent.setup()
    render(<InviteRequestForm />)
    await user.type(screen.getByLabelText('Note (optional)'), 'hello')
    expect(screen.getByText('5 / 1000')).toBeInTheDocument()
  })

  it('sends the honeypot value and has a hidden, unfocusable honeypot field', async () => {
    requestInvite.mockResolvedValue({ kind: 'ok' } satisfies RequestInviteResult)
    const user = userEvent.setup()
    const { container } = render(<InviteRequestForm />)
    const hp = container.querySelector('input[name="website"]') as HTMLInputElement
    expect(hp).toHaveAttribute('tabindex', '-1')
    expect(hp).toHaveAttribute('autocomplete', 'off')
    expect(hp.closest('[aria-hidden="true"]')).not.toBeNull()
    await fill(user)
    await user.type(hp, 'spam.com')
    await submit(user)
    expect(requestInvite).toHaveBeenCalledWith({ name: 'Ann', email: 'ann@x.co', website: 'spam.com' })
  })

  it('shows success and resets the form on ok', async () => {
    requestInvite.mockResolvedValue({ kind: 'ok' })
    const user = userEvent.setup()
    render(<InviteRequestForm />)
    await fill(user)
    await submit(user)
    expect(await screen.findByText("Thanks! We'll email you when your invite is ready.")).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('')
    expect(screen.getByLabelText('Email')).toHaveValue('')
  })

  it.each([
    [{ kind: 'rate-limited' }, /too many requests/i],
    [{ kind: 'invalid', message: 'Bad email domain' }, /bad email domain/i],
    [{ kind: 'database-waking' }, /waking the database/i],
    [{ kind: 'error', message: 'Boom' }, /boom/i],
  ] as [RequestInviteResult, RegExp][])('shows an alert for %j', async (result, text) => {
    requestInvite.mockResolvedValue(result)
    const user = userEvent.setup()
    render(<InviteRequestForm />)
    await fill(user)
    await submit(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(screen.queryByText(/thanks!/i)).not.toBeInTheDocument()
  })

  it('disables submit while sending', async () => {
    let resolve!: (v: RequestInviteResult) => void
    requestInvite.mockReturnValue(new Promise<RequestInviteResult>((r) => { resolve = r }))
    const user = userEvent.setup()
    render(<InviteRequestForm />)
    await fill(user)
    await submit(user)
    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled()
    resolve({ kind: 'ok' })
    expect(await screen.findByRole('button', { name: 'Request an invite' })).toBeEnabled()
  })
})
