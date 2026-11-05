import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../../hooks/useAuth'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type ForgotPasswordFormProps = {
  onLogin: () => void
}

export const ForgotPasswordForm = ({ onLogin }: ForgotPasswordFormProps) => {
  const { requestPasswordReset, status } = useAuth()
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [pending, setPending] = useState(false)
  const [waking, setWaking] = useState(false)
  const [sent, setSent] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  const isWaking = waking || status === 'databaseWaking'

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    const err = EMAIL_RE.test(email.trim()) ? '' : 'Enter a valid email address.'
    setEmailError(err)
    setWaking(false)
    if (err) return
    setPending(true)
    try {
      const result = await requestPasswordReset({ email: email.trim() })
      if (result.kind === 'database-waking') setWaking(true)
      else setSent(true) // identical confirmation whether or not the address exists
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate aria-labelledby="auth-title">
      <h2 id="auth-title" className="auth-title">Reset your password</h2>
      {sent && (
        <p className="auth-confirmation" role="status">
          If an account exists for that address, a password reset link has been sent.
        </p>
      )}
      {isWaking && (
        <p className="auth-waking" role="status">
          Waking the database, one moment. Please try again shortly.
        </p>
      )}
      <div className="auth-field">
        <label htmlFor="forgot-email">Email</label>
        <input
          id="forgot-email"
          ref={emailRef}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? 'forgot-email-error' : undefined}
        />
        {emailError && <p id="forgot-email-error" className="auth-field-error" role="alert">{emailError}</p>}
      </div>
      <button type="submit" className="auth-submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Sending…' : 'Send reset link'}
      </button>
      <div className="auth-links">
        <button type="button" className="auth-link" onClick={onLogin}>Back to sign in</button>
      </div>
    </form>
  )
}
