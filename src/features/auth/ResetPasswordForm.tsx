import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../../hooks/useAuth'

const MIN_PASSWORD = 12
const TOKEN_RE = /^[A-Za-z0-9_-]{1,128}$/

type ResetPasswordFormProps = {
  onLogin: () => void
}

/** Returns the reset token from the URL query string, or null when missing/malformed. */
const readToken = (): string | null => {
  const token = new URLSearchParams(window.location.search).get('token')
  return token && TOKEN_RE.test(token) ? token : null
}

export const ResetPasswordForm = ({ onLogin }: ResetPasswordFormProps) => {
  const { resetPassword, status } = useAuth()
  const [token] = useState(readToken)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [waking, setWaking] = useState(false)
  const [formError, setFormError] = useState('')
  const [done, setDone] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    firstRef.current?.focus()
  }, [])

  useEffect(() => {
    if (formError) errorRef.current?.focus()
  }, [formError])

  const isWaking = waking || status === 'databaseWaking'

  if (token === null) {
    return (
      <div className="auth-form">
        <h2 id="auth-title" className="auth-title">Reset your password</h2>
        <div className="auth-error-summary" role="alert">
          This password reset link is missing or invalid. Request a new link to continue.
        </div>
        <div className="auth-links">
          <button type="button" className="auth-link" onClick={onLogin}>Back to sign in</button>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div className="auth-form">
        <h2 id="auth-title" className="auth-title">Password updated</h2>
        <p className="auth-confirmation" role="status">Your password has been reset. You can now sign in.</p>
        <button type="button" className="auth-submit" onClick={onLogin}>Go to sign in</button>
      </div>
    )
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    const next: Record<string, string> = {}
    if (password.length < MIN_PASSWORD) next.password = `Password must be at least ${MIN_PASSWORD} characters.`
    if (confirm !== password) next.confirm = 'Passwords do not match.'
    setErrors(next)
    setFormError('')
    setWaking(false)
    if (Object.keys(next).length > 0) return
    setPending(true)
    try {
      const result = await resetPassword({ token, password })
      if (result.kind === 'success') setDone(true)
      else if (result.kind === 'database-waking') setWaking(true)
      else setFormError(result.error)
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate aria-labelledby="auth-title">
      <h2 id="auth-title" className="auth-title">Choose a new password</h2>
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
        <label htmlFor="reset-password">New password</label>
        <input
          id="reset-password"
          ref={firstRef}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? 'reset-password-error' : 'reset-password-hint'}
        />
        <p id="reset-password-hint" className="auth-hint">At least {MIN_PASSWORD} characters.</p>
        {errors.password && <p id="reset-password-error" className="auth-field-error" role="alert">{errors.password}</p>}
      </div>
      <div className="auth-field">
        <label htmlFor="reset-confirm">Confirm new password</label>
        <input
          id="reset-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={errors.confirm ? true : undefined}
          aria-describedby={errors.confirm ? 'reset-confirm-error' : undefined}
        />
        {errors.confirm && <p id="reset-confirm-error" className="auth-field-error" role="alert">{errors.confirm}</p>}
      </div>
      <button type="submit" className="auth-submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Resetting…' : 'Reset password'}
      </button>
    </form>
  )
}
