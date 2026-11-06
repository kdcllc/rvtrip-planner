import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../../hooks/useAuth'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 12

const readInviteParam = () => new URLSearchParams(window.location.search).get('invite') ?? ''

type RegisterFormProps = {
  onLogin: () => void
}

export const RegisterForm = ({ onLogin }: RegisterFormProps) => {
  const { register, status } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [inviteCode, setInviteCode] = useState(readInviteParam)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [waking, setWaking] = useState(false)
  const [formError, setFormError] = useState('')
  const emailRef = useRef<HTMLInputElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  useEffect(() => {
    // Keep the invite code out of the address bar and history.
    const url = new URL(window.location.href)
    if (!url.searchParams.has('invite')) return
    url.searchParams.delete('invite')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])

  useEffect(() => {
    if (formError) errorRef.current?.focus()
  }, [formError])

  const isWaking = waking || status === 'databaseWaking'

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    const next: Record<string, string> = {}
    if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address.'
    if (password.length < MIN_PASSWORD) next.password = `Password must be at least ${MIN_PASSWORD} characters.`
    if (confirm !== password) next.confirm = 'Passwords do not match.'
    if (!inviteCode.trim()) next.invite = 'An invite code is required.'
    setErrors(next)
    setFormError('')
    setWaking(false)
    if (Object.keys(next).length > 0) return
    setPending(true)
    try {
      const result = await register({ email: email.trim(), password, inviteCode: inviteCode.trim() })
      if (result.kind === 'database-waking') setWaking(true)
      else if (result.kind !== 'success') setFormError(result.error)
    } finally {
      setPending(false)
    }
  }

  const fieldError = (key: string, id: string) =>
    errors[key] ? (
      <p id={id} className="auth-field-error" role="alert">{errors[key]}</p>
    ) : null

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate aria-labelledby="auth-title">
      <h2 id="auth-title" className="auth-title">Create account</h2>
      {formError && (
        <div className="auth-error-summary" role="alert" tabIndex={-1} ref={errorRef}>
          {formError}
        </div>
      )}
      {isWaking && (
        <p className="auth-waking" role="status">
          Waking the database, one moment. Please try again shortly.
        </p>
      )}
      <div className="auth-field">
        <label htmlFor="register-email">Email</label>
        <input
          id="register-email"
          ref={emailRef}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? 'register-email-error' : undefined}
        />
        {fieldError('email', 'register-email-error')}
      </div>
      <div className="auth-field">
        <label htmlFor="register-password">Password</label>
        <input
          id="register-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? 'register-password-error' : 'register-password-hint'}
        />
        <p id="register-password-hint" className="auth-hint">At least {MIN_PASSWORD} characters.</p>
        {fieldError('password', 'register-password-error')}
      </div>
      <div className="auth-field">
        <label htmlFor="register-confirm">Confirm password</label>
        <input
          id="register-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={errors.confirm ? true : undefined}
          aria-describedby={errors.confirm ? 'register-confirm-error' : undefined}
        />
        {fieldError('confirm', 'register-confirm-error')}
      </div>
      <div className="auth-field">
        <label htmlFor="register-invite">Invite code</label>
        <input
          id="register-invite"
          type="text"
          autoComplete="off"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          aria-invalid={errors.invite ? true : undefined}
          aria-describedby={errors.invite ? 'register-invite-error' : 'register-invite-hint'}
        />
        <p id="register-invite-hint" className="auth-hint">
          An invite code is required to register. No code? Request an invite from the home page.
        </p>
        {fieldError('invite', 'register-invite-error')}
      </div>
      <button type="submit" className="auth-submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Creating account…' : 'Create account'}
      </button>
      <div className="auth-links">
        <button type="button" className="auth-link" onClick={onLogin}>Already have an account? Sign in</button>
      </div>
    </form>
  )
}
