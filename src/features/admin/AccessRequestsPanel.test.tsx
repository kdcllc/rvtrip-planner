import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminInviteRequest } from '../../types/api'

const admin = vi.hoisted(() => ({
  listInviteRequests: vi.fn(),
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
      kind: 'ok',
      request: { ...rows[0], status: 'invited', invitedAt: '2026-02-01T00:00:00Z', inviteCount: 1 },
    })
    const { user } = await setup()
    await user.click(screen.getByRole('button', { name: 'Send invite' }))
    expect(admin.sendInvite).toHaveBeenCalledWith('1')
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Invite sent to ann@example.com')
    )
    expect(screen.getByRole('button', { name: 'Pending (0)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Invited (2)' })).toBeInTheDocument()
  })

  it('shows a row-level alert on email failure', async () => {
    admin.sendInvite.mockResolvedValue({ kind: 'email-failed', message: 'smtp down' })
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
    resolveA({ kind: 'ok', request: { ...rows[0], status: 'invited', inviteCount: 1, invitedAt: '2026-02-01T00:00:00Z' } })
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
})
