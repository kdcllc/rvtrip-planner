import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminInviteRequest } from '../../types/api'

const admin = vi.hoisted(() => ({
  listInviteRequests: vi.fn(),
  createInvite: vi.fn(),
  sendInvite: vi.fn(),
  declineInvite: vi.fn(),
}))
vi.mock('../../services/admin/adminClient', () => admin)

import { AccessRequestsPanel } from './AccessRequestsPanel'

const mk = (over: Partial<AdminInviteRequest>): AdminInviteRequest => ({
  id: 'x',
  email: 'x@example.com',
  name: 'X',
  note: null,
  status: 'pending',
  createdAt: '2026-01-02T12:00:00Z',
  invitedAt: null,
  inviteCount: 0,
  ...over,
})

const rows = [
  mk({ id: '1', email: 'ann@example.com', name: 'Ann' }),
  mk({ id: '2', email: 'bob@example.com', name: 'Bob', status: 'invited', invitedAt: '2026-01-03T12:00:00Z', inviteCount: 2 }),
  mk({ id: '3', email: 'cy@example.com', name: 'Cy', status: 'declined' }),
  mk({ id: '4', email: 'di@example.com', name: 'Di', status: 'registered' }),
]

const setup = async () => {
  const props = { onClose: vi.fn(), onSessionExpired: vi.fn() }
  const user = userEvent.setup()
  render(<AccessRequestsPanel {...props} />)
  await screen.findByRole('table')
  return { props, user }
}

beforeEach(() => {
  vi.resetAllMocks()
  admin.listInviteRequests.mockResolvedValue({ kind: 'ok', requests: rows })
})

describe('AccessRequestsPanel', () => {
  it('renders as a labelled dialog and shows pending rows by default', async () => {
    await setup()
    expect(screen.getByRole('dialog', { name: 'Access requests' })).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('ann@example.com')).toBeInTheDocument()
    expect(screen.queryByText('bob@example.com')).not.toBeInTheDocument()
  })

  it('shows filter counts and switches filters', async () => {
    const { user } = await setup()
    expect(screen.getByRole('button', { name: 'All (4)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pending (1)' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Invited (1)' }))
    expect(screen.getByText('bob@example.com')).toBeInTheDocument()
    expect(screen.getByText(/×2/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resend' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Registered (1)' }))
    expect(screen.queryByRole('button', { name: /^(Send invite|Resend|Decline)$/ })).not.toBeInTheDocument()
  })

  it('send success updates the row and announces', async () => {
    admin.sendInvite.mockResolvedValue({
      kind: 'sent',
      request: { ...rows[0], status: 'invited', invitedAt: '2026-02-01T00:00:00Z', inviteCount: 1 },
      inviteLink: 'https://app.test/invite?code=abc',
      emailSent: true,
    })
    const { user } = await setup()
    await user.click(screen.getByRole('button', { name: 'Send invite' }))
    expect(admin.sendInvite).toHaveBeenCalledWith('1')
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Invite sent to ann@example.com')
    )
    expect(screen.getByLabelText('Invite link for ann@example.com')).toHaveValue(
      'https://app.test/invite?code=abc'
    )
    expect(screen.getByRole('button', { name: 'Pending (0)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Invited (2)' })).toBeInTheDocument()
  })

  it('shows a row-level alert on send error', async () => {
    admin.sendInvite.mockResolvedValue({ kind: 'error', message: 'smtp down' })
    const { user } = await setup()
    await user.click(screen.getByRole('button', { name: 'Send invite' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('smtp down')
    expect(within(screen.getByRole('table')).getByRole('alert')).toBe(alert)
  })

  it('decline asks for confirmation before calling the API', async () => {
    admin.declineInvite.mockResolvedValue({ kind: 'ok', request: { ...rows[0], status: 'declined' } })
    const { user } = await setup()
    await user.click(screen.getByRole('button', { name: 'Decline' }))
    expect(admin.declineInvite).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'No' }))
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Decline' }))
    await user.click(screen.getByRole('button', { name: 'Yes' }))
    expect(admin.declineInvite).toHaveBeenCalledWith('1')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Declined (2)' })).toBeInTheDocument())
  })

  it('shows an Admins only message when forbidden', async () => {
    admin.listInviteRequests.mockResolvedValue({ kind: 'forbidden' })
    const props = { onClose: vi.fn(), onSessionExpired: vi.fn() }
    render(<AccessRequestsPanel {...props} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Admins only')
    expect(props.onSessionExpired).not.toHaveBeenCalled()
  })

  it('calls onSessionExpired when the session has expired', async () => {
    admin.listInviteRequests.mockResolvedValue({ kind: 'session-expired' })
    const props = { onClose: vi.fn(), onSessionExpired: vi.fn() }
    render(<AccessRequestsPanel {...props} />)
    await waitFor(() => expect(props.onSessionExpired).toHaveBeenCalledTimes(1))
  })

  it('shows empty and waking states with retry', async () => {
    admin.listInviteRequests.mockResolvedValueOnce({ kind: 'database-waking' })
    admin.listInviteRequests.mockResolvedValueOnce({ kind: 'ok', requests: [] })
    const user = userEvent.setup()
    render(<AccessRequestsPanel onClose={vi.fn()} onSessionExpired={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No access requests yet')).toBeInTheDocument()
  })

  it('closes on Escape after clicking Decline (focus not on a dialog control)', async () => {
    const { props, user } = await setup()
    await user.click(screen.getByRole('button', { name: 'Decline' }))
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
    await user.keyboard('{Escape}')
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps row B busy after row A resolves', async () => {
    let resolveA: (v: unknown) => void = () => {}
    admin.sendInvite
      .mockImplementationOnce(() => new Promise((res) => { resolveA = res }))
      .mockImplementationOnce(() => new Promise(() => {}))
    admin.listInviteRequests.mockResolvedValue({
      kind: 'ok',
      requests: [rows[0], mk({ id: '5', email: 'eve@example.com', name: 'Eve' })],
    })
    const { user } = await setup()
    const [btnA, btnB] = screen.getAllByRole('button', { name: 'Send invite' })
    await user.click(btnA)
    await user.click(btnB)
    resolveA({
      kind: 'sent',
      request: { ...rows[0], status: 'invited', inviteCount: 1, invitedAt: '2026-02-01T00:00:00Z' },
      inviteLink: 'https://app.test/l',
      emailSent: true,
    })
    await waitFor(() => expect(screen.queryByText('ann@example.com')).not.toBeInTheDocument())
    const rowB = screen.getByText('eve@example.com').closest('tr')!
    expect(rowB).toHaveAttribute('aria-busy', 'true')
    expect(within(rowB).getByRole('button', { name: 'Send invite' })).toBeDisabled()
  })

  it('restores focus to the opener on close', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = render(<AccessRequestsPanel onClose={vi.fn()} onSessionExpired={vi.fn()} />)
    await screen.findByRole('table')
    expect(opener).not.toHaveFocus()
    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('closes on Escape and moves focus inside on open', async () => {
    const { props, user } = await setup()
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
    await user.keyboard('{Escape}')
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  describe('invite form', () => {
    const sentResult = (emailSent: boolean) => ({
      kind: 'sent',
      request: mk({ id: '9', email: 'new@example.com', name: 'new', status: 'invited', inviteCount: 1 }),
      inviteLink: 'https://app.test/invite?code=zzz',
      emailSent,
    })
    const fill = async (user: ReturnType<typeof userEvent.setup>, email: string) => {
      await user.type(screen.getByLabelText('Email'), email)
      await user.click(screen.getByRole('button', { name: 'Invite' }))
    }

    it('validates the email client-side without calling the API', async () => {
      const { user } = await setup()
      await fill(user, 'not-an-email')
      const alert = await screen.findByText('Enter a valid email address')
      expect(screen.getByLabelText('Email')).toHaveAttribute('aria-describedby', alert.id)
      expect(admin.createInvite).not.toHaveBeenCalled()
    })

    it('shows the link and emailed message on success and clears the form', async () => {
      admin.createInvite.mockResolvedValue(sentResult(true))
      const { user } = await setup()
      await user.type(screen.getByLabelText('Name (optional)'), 'New')
      await fill(user, ' new@example.com ')
      expect(admin.createInvite).toHaveBeenCalledWith({ email: 'new@example.com', name: 'New' })
      expect(await screen.findByText(/Invite emailed to new@example.com\./)).toBeInTheDocument()
      expect(screen.getByLabelText('Invite link for new@example.com')).toHaveValue(
        'https://app.test/invite?code=zzz'
      )
      expect(screen.getByLabelText('Email')).toHaveValue('')
      expect(screen.getByLabelText('Name (optional)')).toHaveValue('')
      await user.click(screen.getByRole('button', { name: 'Invited (2)' }))
      expect(screen.getByText('new@example.com')).toBeInTheDocument()
    })

    it('shows the manual-send message when email was not sent', async () => {
      admin.createInvite.mockResolvedValue(sentResult(false))
      const { user } = await setup()
      await fill(user, 'new@example.com')
      expect(
        await screen.findByText('Email not sent — copy the link below and send it yourself.')
      ).toBeInTheDocument()
    })

    it('shows a conflict message', async () => {
      admin.createInvite.mockResolvedValue({ kind: 'conflict', message: 'exists' })
      const { user } = await setup()
      await fill(user, 'ann@example.com')
      expect(await screen.findByText('ann@example.com already has an account.')).toBeInTheDocument()
    })

    it('shows Inviting… and disables submit while busy', async () => {
      admin.createInvite.mockImplementation(() => new Promise(() => {}))
      const { user } = await setup()
      await fill(user, 'new@example.com')
      expect(await screen.findByRole('button', { name: 'Inviting…' })).toBeDisabled()
    })

    it('Copy writes to the clipboard and shows Copied; Done hides the link', async () => {
      admin.createInvite.mockResolvedValue(sentResult(true))
      const { user } = await setup()
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      await fill(user, 'new@example.com')
      await user.click(await screen.findByRole('button', { name: 'Copy' }))
      expect(writeText).toHaveBeenCalledWith('https://app.test/invite?code=zzz')
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Done' }))
      expect(screen.queryByLabelText('Invite link for new@example.com')).not.toBeInTheDocument()
    })

    it('Send invite emailSent=false shows the manual-send message', async () => {
      admin.sendInvite.mockResolvedValue({ ...sentResult(false), request: { ...rows[0], status: 'invited' } })
      const { user } = await setup()
      await user.click(screen.getByRole('button', { name: 'Send invite' }))
      expect(await screen.findByText(/Email not sent/)).toBeInTheDocument()
      expect(screen.getByLabelText('Invite link for ann@example.com')).toBeInTheDocument()
    })
  })
})
