import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiResult } from '../../types/auth'
import type { AuthContextType, AuthStatus } from '../../hooks/authContext'

const auth = vi.hoisted(() => ({ value: {} as unknown as AuthContextType }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth.value }))
vi.mock('../../components/common/ThemeToggle', () => ({ ThemeToggle: () => null }))

import { AuthScreen } from './AuthScreen'
import { LoginForm } from './LoginForm'
import { RegisterForm } from './RegisterForm'
import { ForgotPasswordForm } from './ForgotPasswordForm'
import { ResetPasswordForm } from './ResetPasswordForm'

const ok = { kind: 'success', status: 200, data: { ok: true } } as const

const setAuth = (over: Partial<AuthContextType> = {}, status: AuthStatus = 'unauthenticated') => {
  auth.value = {
    status,
    user: null,
    login: vi.fn().mockResolvedValue({ kind: 'success', status: 200, data: { user: { id: '1', email: 'a@b.co' } } }),
    register: vi.fn().mockResolvedValue({ kind: 'success', status: 201, data: { user: { id: '1', email: 'a@b.co' } } }),
    logout: vi.fn(),
    requestPasswordReset: vi.fn().mockResolvedValue(ok),
    resetPassword: vi.fn().mockResolvedValue(ok),
    ...over,
  }
}

const setUrl = (url: string) => window.history.replaceState(null, '', url)
const noop = () => {}

beforeEach(() => {
  setAuth()
  setUrl('/')
})

describe('labels (AC2)', () => {
  it('login fields have labels', () => {
    render(<LoginForm onForgotPassword={noop} onRegister={noop} />)
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })
  it('register fields have labels', () => {
    render(<RegisterForm onLogin={noop} />)
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument()
    expect(screen.getByLabelText('Invite code')).toBeInTheDocument()
    expect(screen.getByText(/invite code is required/i)).toBeInTheDocument()
  })
  it('forgot fields have labels', () => {
    render(<ForgotPasswordForm onLogin={noop} />)
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })
  it('reset fields have labels', () => {
    setUrl('/reset-password?token=abc_DEF-123')
    render(<ResetPasswordForm onLogin={noop} />)
    expect(screen.getByLabelText('New password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm new password')).toBeInTheDocument()
  })
})

describe('AuthScreen routing', () => {
  it('switches views and reads reset URL', async () => {
    const user = userEvent.setup()
    render(<AuthScreen />)
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create an account' }))
    expect(screen.getByRole('heading', { name: 'Create account' })).toBeInTheDocument()
  })
  it('opens reset view from the URL', () => {
    setUrl('/reset-password?token=abc123')
    render(<AuthScreen />)
    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument()
  })
})

describe('AuthScreen entry points', () => {
  it('opens in register mode and shows Back only when onBack is given', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    const { unmount } = render(<AuthScreen initialMode="register" onBack={onBack} />)
    expect(screen.getByRole('heading', { name: 'Create account' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '← Back' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    unmount()
    render(<AuthScreen />)
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '← Back' })).not.toBeInTheDocument()
  })
  it('reset token wins over initialMode', () => {
    setUrl('/reset-password?token=abc123')
    render(<AuthScreen initialMode="register" />)
    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument()
  })
  it('prefills the invite code from ?invite= and removes it from the URL', () => {
    setUrl('/?invite=abc&x=1')
    render(<RegisterForm onLogin={noop} />)
    expect(screen.getByLabelText('Invite code')).toHaveValue('abc')
    expect(window.location.search).toBe('?x=1')
  })
})

describe('validation', () => {
  it('register rejects short password, mismatch and missing invite', async () => {
    const user = userEvent.setup()
    render(<RegisterForm onLogin={noop} />)
    await user.type(screen.getByLabelText('Email'), 'a@b.co')
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.type(screen.getByLabelText('Confirm password'), 'other')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByText(/at least 12 characters/i, { selector: '[role="alert"]' })).toBeInTheDocument()
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument()
    expect(screen.getByText('An invite code is required.')).toBeInTheDocument()
    expect(auth.value.register).not.toHaveBeenCalled()
  })
  it('login rejects bad email', async () => {
    const user = userEvent.setup()
    render(<LoginForm onForgotPassword={noop} onRegister={noop} />)
    await user.type(screen.getByLabelText('Email'), 'nope')
    await user.type(screen.getByLabelText('Password'), 'x')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(auth.value.login).not.toHaveBeenCalled()
  })
  it('register submits valid data', async () => {
    const user = userEvent.setup()
    render(<RegisterForm onLogin={noop} />)
    await user.type(screen.getByLabelText('Email'), 'a@b.co')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery')
    await user.type(screen.getByLabelText('Confirm password'), 'correct horse battery')
    await user.type(screen.getByLabelText('Invite code'), 'INV1')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(auth.value.register).toHaveBeenCalledWith({
      email: 'a@b.co',
      password: 'correct horse battery',
      inviteCode: 'INV1',
    })
  })
})

describe('in-flight (AC3)', () => {
  it('disables submit while a request is pending (login)', async () => {
    let resolve: (r: ApiResult<never>) => void = noop
    const login = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)))
    setAuth({ login })
    const user = userEvent.setup()
    render(<LoginForm onForgotPassword={noop} onRegister={noop} />)
    await user.type(screen.getByLabelText('Email'), 'a@b.co')
    await user.type(screen.getByLabelText('Password'), 'pw')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    const btn = await screen.findByRole('button', { name: 'Signing in…' })
    expect(btn).toBeDisabled()
    expect(login).toHaveBeenCalledTimes(1)
    resolve({ kind: 'success', status: 200, data: undefined as never })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled())
  })
  it('disables submit while pending (register, forgot, reset)', async () => {
    const user = userEvent.setup()
    const never = () => new Promise<never>(() => {})
    setAuth({ register: vi.fn(never), requestPasswordReset: vi.fn(never), resetPassword: vi.fn(never) })

    const reg = render(<RegisterForm onLogin={noop} />)
    await user.type(screen.getByLabelText('Email'), 'a@b.co')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery')
    await user.type(screen.getByLabelText('Confirm password'), 'correct horse battery')
    await user.type(screen.getByLabelText('Invite code'), 'X')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('button', { name: 'Creating account…' })).toBeDisabled()
    reg.unmount()

    const fg = render(<ForgotPasswordForm onLogin={noop} />)
    await user.type(screen.getByLabelText('Email'), 'a@b.co')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled()
    fg.unmount()

    setUrl('/reset-password?token=abc123')
    render(<ResetPasswordForm onLogin={noop} />)
    await user.type(screen.getByLabelText('New password'), 'correct horse battery')
    await user.type(screen.getByLabelText('Confirm new password'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: 'Reset password' }))
    expect(await screen.findByRole('button', { name: 'Resetting…' })).toBeDisabled()
  })
})

describe('databaseWaking (AC4)', () => {
  it('renders a distinct waking message, different from idle and error', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<LoginForm onForgotPassword={noop} onRegister={noop} />)
    expect(screen.queryByText(/waking the database/i)).not.toBeInTheDocument()
    unmount()

    setAuth({ login: vi.fn().mockResolvedValue({ kind: 'auth-failure', status: 401, error: 'Invalid credentials' }) })
    const err = render(<LoginForm onForgotPassword={noop} onRegister={noop} />)
    await user.type(screen.getByLabelText('Email'), 'a@b.co')
    await user.type(screen.getByLabelText('Password'), 'pw')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument()
    expect(screen.queryByText(/waking the database/i)).not.toBeInTheDocument()
    err.unmount()

    setAuth({}, 'databaseWaking')
    render(<LoginForm onForgotPassword={noop} onRegister={noop} />)
    const waking = screen.getByText(/waking the database, one moment/i)
    expect(waking).toBeInTheDocument()
    expect(screen.queryByText('Invalid credentials')).not.toBeInTheDocument()
  })
  it('renders waking when a call returns database-waking', async () => {
    setAuth({ login: vi.fn().mockResolvedValue({ kind: 'database-waking', status: 503 }) })
    const user = userEvent.setup()
    render(<LoginForm onForgotPassword={noop} onRegister={noop} />)
    await user.type(screen.getByLabelText('Email'), 'a@b.co')
    await user.type(screen.getByLabelText('Password'), 'pw')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(/waking the database, one moment/i)).toBeInTheDocument()
  })
})

describe('forgot password (AC5)', () => {
  it('shows the identical confirmation for known and unknown emails', async () => {
    const user = userEvent.setup()
    const texts: (string | null)[] = []
    for (const email of ['known@x.co', 'unknown@x.co']) {
      const view = render(<ForgotPasswordForm onLogin={noop} />)
      await user.type(screen.getByLabelText('Email'), email)
      await user.click(screen.getByRole('button', { name: 'Send reset link' }))
      texts.push((await screen.findByText(/reset link has been sent/i)).textContent)
      view.unmount()
    }
    expect(texts[0]).toBe(texts[1])
  })
})

describe('reset password token (AC6)', () => {
  it('shows an explicit error and does not submit when token is missing', () => {
    setUrl('/reset-password')
    render(<ResetPasswordForm onLogin={noop} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/missing or invalid/i)
    expect(screen.queryByRole('button', { name: 'Reset password' })).not.toBeInTheDocument()
    expect(auth.value.resetPassword).not.toHaveBeenCalled()
  })
  it('shows an error for a malformed token', () => {
    setUrl('/reset-password?token=bad%20token!')
    render(<ResetPasswordForm onLogin={noop} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/missing or invalid/i)
  })
  it('submits the token from the URL', async () => {
    setUrl('/reset-password?token=abc_DEF-123')
    const user = userEvent.setup()
    render(<ResetPasswordForm onLogin={noop} />)
    await user.type(screen.getByLabelText('New password'), 'correct horse battery')
    await user.type(screen.getByLabelText('Confirm new password'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: 'Reset password' }))
    expect(auth.value.resetPassword).toHaveBeenCalledWith({ token: 'abc_DEF-123', password: 'correct horse battery' })
  })
})
