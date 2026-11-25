import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../components/common/ThemeToggle', () => ({ ThemeToggle: () => null }))
vi.mock('../../services/invites/inviteClient', () => ({ requestInvite: vi.fn() }))

import { LandingPage } from './LandingPage'

describe('LandingPage', () => {
  it('renders landmarks, one h1 and the request section anchor', () => {
    const { container } = render(<LandingPage onSignUp={vi.fn()} onLogIn={vi.fn()} />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(container.querySelector('header')).not.toBeNull()
    expect(container.querySelector('main')).not.toBeNull()
    expect(container.querySelector('footer')).not.toBeNull()
    expect(container.querySelector('#request-invite')).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Request an invite' })).toHaveAttribute('href', '#request-invite')
  })

  it('shows the app version in the footer', () => {
    const { container } = render(<LandingPage onSignUp={vi.fn()} onLogIn={vi.fn()} />)
    const label = container.querySelector('footer [data-testid="app-version"]')
    expect(label).not.toBeNull()
    expect(label).toHaveTextContent('v0.0.0-test (testsha)')
  })

  it('calls onSignUp and onLogIn', async () => {
    const user = userEvent.setup()
    const onSignUp = vi.fn()
    const onLogIn = vi.fn()
    render(<LandingPage onSignUp={onSignUp} onLogIn={onLogIn} />)
    await user.click(screen.getByRole('button', { name: 'Sign up with invite code' }))
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    expect(onSignUp).toHaveBeenCalledTimes(1)
    expect(onLogIn).toHaveBeenCalledTimes(1)
  })
})
