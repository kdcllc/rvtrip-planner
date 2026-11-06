import { useCallback, useEffect, useRef, useState } from 'react'
import { declineInvite, listInviteRequests, sendInvite } from '../../services/admin/adminClient'
import type { InviteActionResult } from '../../services/admin/adminClient'
import type { AdminInviteRequest, InviteRequestStatus } from '../../types/api'
import './AccessRequestsPanel.css'

interface AccessRequestsPanelProps {
  onClose: () => void
  onSessionExpired: () => void
}

type Filter = 'all' | InviteRequestStatus
type LoadState = 'loading' | 'ready' | 'waking' | 'error' | 'forbidden'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'invited', label: 'Invited' },
  { id: 'declined', label: 'Declined' },
  { id: 'registered', label: 'Registered' },
]

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
const ADMINS_ONLY = 'Admins only. Your account does not have access to this panel.'

const formatDate = (iso: string | null): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

export function AccessRequestsPanel({ onClose, onSessionExpired }: AccessRequestsPanelProps) {
  const [requests, setRequests] = useState<AdminInviteRequest[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')
  const [filter, setFilter] = useState<Filter>('pending')
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set())
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [announcement, setAnnouncement] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onSessionExpiredRef = useRef(onSessionExpired)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onSessionExpiredRef.current = onSessionExpired
    onCloseRef.current = onClose
  }, [onSessionExpired, onClose])

  // Focus management: move focus in on open, restore on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => previous?.focus?.()
  }, [])

  const load = useCallback(async () => {
    setLoadState('loading')
    const result = await listInviteRequests()
    switch (result.kind) {
      case 'ok':
        setRequests(result.requests)
        setLoadState('ready')
        break
      case 'database-waking':
        setLoadState('waking')
        break
      case 'forbidden':
        setLoadState('forbidden')
        break
      case 'session-expired':
        onSessionExpiredRef.current()
        break
      default:
        setLoadError(result.message)
        setLoadState('error')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void load()
  }, [load])

  const runAction = async (req: AdminInviteRequest, action: 'invite' | 'decline') => {
    setConfirmId(null)
    setBusyIds((prev) => new Set(prev).add(req.id))
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[req.id]
      return next
    })
    const result: InviteActionResult =
      action === 'invite' ? await sendInvite(req.id) : await declineInvite(req.id)
    setBusyIds((prev) => {
      const next = new Set(prev)
      next.delete(req.id)
      return next
    })
    const fail = (message: string) => setRowErrors((prev) => ({ ...prev, [req.id]: message }))
    switch (result.kind) {
      case 'ok':
        setRequests((prev) => prev.map((r) => (r.id === result.request.id ? result.request : r)))
        setAnnouncement(
          action === 'invite' ? `Invite sent to ${req.email}` : `Request from ${req.email} declined`
        )
        break
      case 'session-expired':
        onSessionExpiredRef.current()
        break
      case 'forbidden':
        fail(ADMINS_ONLY)
        break
      case 'email-failed':
        fail(`Email could not be sent: ${result.message}`)
        break
      case 'conflict':
        fail(`Conflict: ${result.message}`)
        break
      case 'database-waking':
        fail('The database is waking up. Try again in a moment.')
        break
      default:
        fail(result.message)
    }
  }

  // Escape and Tab trap live on document so they work even when focus has fallen to body.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        const active = document.activeElement
        if (!dialogRef.current.contains(active)) {
          e.preventDefault()
          first.focus()
        } else if (e.shiftKey && active === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // If a re-render removed the focused control (e.g. Decline -> confirm), keep focus in the dialog.
  useEffect(() => {
    if (dialogRef.current && !dialogRef.current.contains(document.activeElement)) {
      closeRef.current?.focus()
    }
  }, [confirmId, busyIds, requests, loadState])

  const counts = (id: Filter) =>
    id === 'all' ? requests.length : requests.filter((r) => r.status === id).length
  const visible = filter === 'all' ? requests : requests.filter((r) => r.status === filter)

  const renderActions = (req: AdminInviteRequest) => {
    if (req.status === 'registered') return <span className="access-muted">—</span>
    const busy = busyIds.has(req.id)
    if (confirmId === req.id) {
      return (
        <span className="access-confirm" role="group" aria-label={`Confirm decline for ${req.email}`}>
          Decline?{' '}
          <button type="button" className="ghost" onClick={() => void runAction(req, 'decline')}>
            Yes
          </button>
          <button type="button" className="ghost" onClick={() => setConfirmId(null)}>
            No
          </button>
        </span>
      )
    }
    return (
      <span className="access-actions" aria-busy={busy}>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() => void runAction(req, 'invite')}
        >
          {req.status === 'invited' ? 'Resend' : 'Send invite'}
        </button>
        {req.status !== 'declined' && (
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => setConfirmId(req.id)}
          >
            Decline
          </button>
        )}
      </span>
    )
  }

  const renderBody = () => {
    if (loadState === 'loading') return <p className="access-state">Loading access requests…</p>
    if (loadState === 'forbidden') return <p className="access-state" role="alert">{ADMINS_ONLY}</p>
    if (loadState === 'waking') {
      return (
        <div className="access-state" role="status">
          <p>The database is waking up. This can take a few seconds.</p>
          <button type="button" className="ghost" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )
    }
    if (loadState === 'error') {
      return (
        <div className="access-state" role="alert">
          <p>Could not load access requests: {loadError}</p>
          <button type="button" className="ghost" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )
    }
    if (requests.length === 0) return <p className="access-state">No access requests yet</p>
    return (
      <>
        <div className="access-filters" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`ghost access-filter${filter === f.id ? ' active' : ''}`}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label} ({counts(f.id)})
            </button>
          ))}
        </div>
        <div className="access-table-scroll">
          <table className="access-table">
            <caption className="access-sr-only">Access requests</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Note</th>
                <th scope="col">Requested</th>
                <th scope="col">Status</th>
                <th scope="col">Invited</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="access-muted">
                    No {filter} requests
                  </td>
                </tr>
              )}
              {visible.map((req) => (
                <tr key={req.id} aria-busy={busyIds.has(req.id)}>
                  <th scope="row">{req.name}</th>
                  <td>{req.email}</td>
                  <td>{req.note ?? '—'}</td>
                  <td>{formatDate(req.createdAt)}</td>
                  <td>
                    <span className={`access-badge access-badge-${req.status}`}>{req.status}</span>
                  </td>
                  <td>
                    {req.invitedAt ? `${formatDate(req.invitedAt)} (×${req.inviteCount})` : '—'}
                  </td>
                  <td>
                    {renderActions(req)}
                    {rowErrors[req.id] && (
                      <p className="access-row-error" role="alert">
                        {rowErrors[req.id]}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )
  }

  return (
    <div className="access-backdrop">
      <div
        ref={dialogRef}
        className="access-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="access-requests-title"
      >
        <header className="access-header">
          <h2 id="access-requests-title">Access requests</h2>
          <button ref={closeRef} type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </header>
        <div role="status" aria-live="polite" className="access-sr-only">
          {announcement}
        </div>
        {renderBody()}
      </div>
    </div>
  )
}
