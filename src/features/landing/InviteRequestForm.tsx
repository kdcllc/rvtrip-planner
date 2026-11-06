import { useState, type FormEvent } from 'react'
import { requestInvite } from '../../services/invites/inviteClient'
import '../auth/auth.css'
import './LandingPage.css'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NOTE_MAX = 1000

export const InviteRequestForm = () => {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [website, setWebsite] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [success, setSuccess] = useState(false)
  const [alertText, setAlertText] = useState('')

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = 'Enter your name.'
    if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address.'
    if (note.length > NOTE_MAX) next.note = `Note must be ${NOTE_MAX} characters or fewer.`
    setErrors(next)
    setAlertText('')
    setSuccess(false)
    if (Object.keys(next).length > 0) return
    setPending(true)
    try {
      const trimmedNote = note.trim()
      const result = await requestInvite({
        name: name.trim(),
        email: email.trim(),
        ...(trimmedNote ? { note: trimmedNote } : {}),
        website,
      })
      switch (result.kind) {
        case 'ok':
          setSuccess(true)
          setName('')
          setEmail('')
          setNote('')
          setWebsite('')
          break
        case 'rate-limited':
          setAlertText('Too many requests. Please try again later.')
          break
        case 'invalid':
          setAlertText(result.message)
          break
        case 'database-waking':
          setAlertText('Waking the database, one moment. Please try again shortly.')
          break
        case 'error':
          setAlertText(result.message || 'Something went wrong. Please try again.')
          break
      }
    } finally {
      setPending(false)
    }
  }

  const fieldError = (key: string, id: string) =>
    errors[key] ? (
      <p id={id} className="auth-field-error" role="alert">{errors[key]}</p>
    ) : null

  return (
    <form className="auth-form invite-form" onSubmit={handleSubmit} noValidate aria-label="Request an invite">
      {success && (
        <p className="auth-confirmation" role="status">Thanks! We'll email you when your invite is ready.</p>
      )}
      {alertText && <div className="auth-error-summary" role="alert">{alertText}</div>}
      <div className="auth-field">
        <label htmlFor="invite-name">Name</label>
        <input
          id="invite-name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? 'invite-name-error' : undefined}
        />
        {fieldError('name', 'invite-name-error')}
      </div>
      <div className="auth-field">
        <label htmlFor="invite-email">Email</label>
        <input
          id="invite-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? 'invite-email-error' : undefined}
        />
        {fieldError('email', 'invite-email-error')}
      </div>
      <div className="auth-field">
        <label htmlFor="invite-note">Note (optional)</label>
        <textarea
          id="invite-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-invalid={errors.note ? true : undefined}
          aria-describedby={errors.note ? 'invite-note-error invite-note-count' : 'invite-note-count'}
        />
        <p id="invite-note-count" className="auth-hint">{note.length} / {NOTE_MAX}</p>
        {fieldError('note', 'invite-note-error')}
      </div>
      <div className="invite-honeypot" aria-hidden="true">
        <label htmlFor="invite-website">Website</label>
        <input
          id="invite-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>
      <button type="submit" className="auth-submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Sending…' : 'Request an invite'}
      </button>
    </form>
  )
}
