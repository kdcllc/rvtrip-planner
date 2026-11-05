import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../../hooks/useAuth'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type LoginFormProps = {
  onForgotPassword: () => void
  onRegister: () => void
}

export const LoginForm = ({ onForgotPassword, onRegister }: LoginFormProps) => {
  const { login, status } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [waking, setWaking] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [formError, setFormError] = useState('')
  const emailRef = useRef<HTMLInputElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  useEffect(() => {
    if (formError) errorRef.current?.focus()
  }, [formError])

  const isWaking = waking || status === 'databaseWaking'

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    const eErr = EMAIL_RE.test(email.trim()) ? '' : 'Enter a valid email address.'
    const pErr = password ? '' : 'Enter your password.'
    setEmailError(eErr)
    setPasswordError(pErr)
    setFormError('')
    setWaking(false)
    if (eErr || pErr) return
    setPending(true)
    try {
      const result = await login({ email: email.trim(), password })
      if (result.kind === 'database-waking') setWaking(true)
      else if (result.kind !== 'success') setFormError(result.error)
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate aria-labelledby="auth-title">
      <h2 id="auth-title" className="auth-title">Sign in</h2>
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
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          ref={emailRef}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? 'login-email-error' : undefined}
        />
        {emailError && <p id="login-email-error" className="auth-field-error" role="alert">{emailError}</p>}
      </div>
      <div className="auth-field">
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={passwordError ? true : undefined}
          aria-describedby={passwordError ? 'login-password-error' : undefined}
        />
        {passwordError && <p id="login-password-error" className="auth-field-error" role="alert">{passwordError}</p>}
      </div>
      <button type="submit" className="auth-submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
      <div className="auth-links">
        <button type="button" className="auth-link" onClick={onForgotPassword}>Forgot password?</button>
        <button type="button" className="auth-link" onClick={onRegister}>Create an account</button>
      </div>
    </form>
  )
}
