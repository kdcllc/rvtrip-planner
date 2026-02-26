import { useState, useMemo } from 'react'
import './UnifiedConflictModal.css'
import type {
  TripConflict,
  TripConflictDecision,
  TripConflictAction,
  TripConflictCategory,
} from '../../domain/trip/conflicts'

interface UnifiedConflictModalProps {
  conflicts: TripConflict[]
  onResolve: (decisions: TripConflictDecision[]) => void
  onCancel?: () => void
}

export function UnifiedConflictModal({
  conflicts,
  onResolve,
  onCancel,
}: UnifiedConflictModalProps) {
  const [selections, setSelections] = useState<Record<string, TripConflictAction>>({})
  const [categoryFilter, setCategoryFilter] = useState<TripConflictCategory | 'all'>('all')

  const filteredConflicts = useMemo(() => {
    if (categoryFilter === 'all') return conflicts
    return conflicts.filter((c) => c.category === categoryFilter)
  }, [conflicts, categoryFilter])

  const categoryCounts = useMemo(() => {
    const counts: Record<TripConflictCategory, number> = {
      'remote-newer': 0,
      'local-newer': 0,
      'missing-remote': 0,
      'missing-local': 0,
      'checksum-mismatch': 0,
    }
    conflicts.forEach((c) => {
      counts[c.category] = (counts[c.category] || 0) + 1
    })
    return counts
  }, [conflicts])

  const handleSelection = (conflictId: string, action: TripConflictAction) => {
    setSelections((prev) => ({ ...prev, [conflictId]: action }))
  }

  const handleSelectAll = (action: TripConflictAction) => {
    const nextSelections: Record<string, TripConflictAction> = {}
    filteredConflicts.forEach((conflict) => {
      nextSelections[conflict.id] = action
    })
    setSelections((prev) => ({ ...prev, ...nextSelections }))
  }

  const handleApply = () => {
    const decisions: TripConflictDecision[] = conflicts
      .filter((conflict) => selections[conflict.id])
      .map((conflict) => ({
        conflictId: conflict.id,
        action: selections[conflict.id],
      }))

    if (decisions.length > 0) {
      onResolve(decisions)
    }
  }

  const allSelected = conflicts.every((c) => Boolean(selections[c.id]))
  const selectedCount = conflicts.filter((c) => Boolean(selections[c.id])).length
  const hasSelections = selectedCount > 0

  if (conflicts.length === 0) return null

  return (
    <div className="unified-conflict-backdrop" role="dialog" aria-modal="true">
      <div className="unified-conflict-modal">
        <div className="unified-conflict-header">
          <h2>Resolve conflicts</h2>
          <p className="unified-conflict-subtitle">
            {conflicts.length} conflict{conflicts.length === 1 ? '' : 's'} detected. Choose an
            action for each before continuing.
          </p>
        </div>

        <div className="unified-conflict-filters">
          <button
            type="button"
            className={`filter-chip${categoryFilter === 'all' ? ' filter-chip--active' : ''}`}
            onClick={() => setCategoryFilter('all')}
          >
            All ({conflicts.length})
          </button>
          {categoryCounts['remote-newer'] > 0 && (
            <button
              type="button"
              className={`filter-chip${categoryFilter === 'remote-newer' ? ' filter-chip--active' : ''}`}
              onClick={() => setCategoryFilter('remote-newer')}
            >
              Remote newer ({categoryCounts['remote-newer']})
            </button>
          )}
          {categoryCounts['local-newer'] > 0 && (
            <button
              type="button"
              className={`filter-chip${categoryFilter === 'local-newer' ? ' filter-chip--active' : ''}`}
              onClick={() => setCategoryFilter('local-newer')}
            >
              Local newer ({categoryCounts['local-newer']})
            </button>
          )}
          {categoryCounts['checksum-mismatch'] > 0 && (
            <button
              type="button"
              className={`filter-chip${categoryFilter === 'checksum-mismatch' ? ' filter-chip--active' : ''}`}
              onClick={() => setCategoryFilter('checksum-mismatch')}
            >
              Content differs ({categoryCounts['checksum-mismatch']})
            </button>
          )}
          {categoryCounts['missing-local'] > 0 && (
            <button
              type="button"
              className={`filter-chip${categoryFilter === 'missing-local' ? ' filter-chip--active' : ''}`}
              onClick={() => setCategoryFilter('missing-local')}
            >
              Only in Drive ({categoryCounts['missing-local']})
            </button>
          )}
          {categoryCounts['missing-remote'] > 0 && (
            <button
              type="button"
              className={`filter-chip${categoryFilter === 'missing-remote' ? ' filter-chip--active' : ''}`}
              onClick={() => setCategoryFilter('missing-remote')}
            >
              Only local ({categoryCounts['missing-remote']})
            </button>
          )}
        </div>

        <div className="unified-conflict-guidance" role="status" aria-live="polite">
          <span className="unified-conflict-progress">
            Resolved {selectedCount} of {conflicts.length} conflicts.
          </span>
          <span>
            Apply requires all conflicts to be resolved
            {categoryFilter === 'all' ? '.' : '; filters only affect bulk actions.'}
          </span>
        </div>

        <div className="unified-conflict-bulk-actions">
          <span>Select all:</span>
          <button
            type="button"
            className="ghost ghost--small"
            onClick={() => handleSelectAll('use-local')}
          >
            Use Local
          </button>
          <button
            type="button"
            className="ghost ghost--small"
            onClick={() => handleSelectAll('use-remote')}
          >
            Use Drive
          </button>
          <button
            type="button"
            className="ghost ghost--small"
            onClick={() => handleSelectAll('create-new')}
          >
            Create Copy
          </button>
        </div>

        <div className="unified-conflict-list">
          {filteredConflicts.map((conflict) => (
            <ConflictCard
              key={conflict.id}
              conflict={conflict}
              selected={selections[conflict.id]}
              onSelect={handleSelection}
            />
          ))}
        </div>

        <div className="unified-conflict-actions">
          <button
            type="button"
            className="button-primary"
            onClick={handleApply}
            disabled={!allSelected}
          >
            Apply{hasSelections ? ` (${selectedCount})` : ''}
          </button>
          {onCancel && (
            <button type="button" className="ghost" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

interface ConflictCardProps {
  conflict: TripConflict
  selected?: TripConflictAction
  onSelect: (conflictId: string, action: TripConflictAction) => void
}

function ConflictCard({ conflict, selected, onSelect }: ConflictCardProps) {
  const categoryLabel = getCategoryLabel(conflict.category)
  const hasLocal = Boolean(conflict.local)
  const hasIncoming = Boolean(conflict.incoming)

  return (
    <div className="conflict-card">
      <div className="conflict-card-header">
        <strong>{conflict.local?.name ?? conflict.incoming?.name ?? 'Unknown trip'}</strong>
        <span className="conflict-badge">{categoryLabel}</span>
      </div>

      <div className="conflict-comparison">
        <div className="conflict-side">
          <div className="conflict-side-label">Local</div>
          {hasLocal ? (
            <>
              <div className="conflict-meta">
                <strong>{conflict.local?.name}</strong>
              </div>
              <div className="conflict-meta">
                Updated: {formatTimestamp(conflict.local?.updatedAt)}
              </div>
              <div className="conflict-meta">
                Stops: {conflict.local?.stopCount ?? 'Unknown'}
              </div>
              {conflict.local?.lastSyncedAt && (
                <div className="conflict-meta-subtle">
                  Last synced: {formatTimestamp(conflict.local.lastSyncedAt)}
                </div>
              )}
            </>
          ) : (
            <div className="conflict-meta-empty">Not found locally</div>
          )}
        </div>

        <div className="conflict-divider" />

        <div className="conflict-side">
          <div className="conflict-side-label">Drive</div>
          {hasIncoming ? (
            <>
              <div className="conflict-meta">
                <strong>{conflict.incoming?.name}</strong>
              </div>
              <div className="conflict-meta">
                Updated: {formatTimestamp(conflict.incoming?.updatedAt)}
              </div>
              <div className="conflict-meta">
                Stops: {conflict.incoming?.stopCount ?? 'Unknown'}
              </div>
              {conflict.incoming?.deviceId && (
                <div className="conflict-meta-subtle">
                  Device: {conflict.incoming.deviceId.slice(0, 8)}...
                </div>
              )}
            </>
          ) : (
            <div className="conflict-meta-empty">Not found in Drive</div>
          )}
        </div>
      </div>

      <div className="conflict-actions">
        {hasLocal && (
          <label className="conflict-action-radio">
            <input
              type="radio"
              name={`conflict-${conflict.id}`}
              checked={selected === 'use-local'}
              onChange={() => onSelect(conflict.id, 'use-local')}
            />
            <span>Use Local</span>
          </label>
        )}
        {hasIncoming && (
          <>
            <label className="conflict-action-radio">
              <input
                type="radio"
                name={`conflict-${conflict.id}`}
                checked={selected === 'use-remote'}
                onChange={() => onSelect(conflict.id, 'use-remote')}
              />
              <span>Use Drive</span>
            </label>
            <label className="conflict-action-radio">
              <input
                type="radio"
                name={`conflict-${conflict.id}`}
                checked={selected === 'create-new'}
                onChange={() => onSelect(conflict.id, 'create-new')}
              />
              <span>Create Copy</span>
            </label>
          </>
        )}
        <label className="conflict-action-radio">
          <input
            type="radio"
            name={`conflict-${conflict.id}`}
            checked={selected === 'ignore'}
            onChange={() => onSelect(conflict.id, 'ignore')}
          />
          <span>Ignore</span>
        </label>
      </div>
    </div>
  )
}

function getCategoryLabel(category: TripConflictCategory): string {
  switch (category) {
    case 'remote-newer':
      return 'Drive is newer'
    case 'local-newer':
      return 'Local is newer'
    case 'missing-remote':
      return 'Deleted from Drive'
    case 'missing-local':
      return 'Only in Drive'
    case 'checksum-mismatch':
      return 'Content differs'
    default:
      return 'Unknown'
  }
}

function formatTimestamp(value?: string): string {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  }).format(date)
}
