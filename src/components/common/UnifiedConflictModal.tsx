import { useState, useMemo } from 'react'
import './UnifiedConflictModal.css'
import type {
  TripConflict,
  TripConflictDecision,
  TripConflictAction,
  TripConflictCategory,
  TripStopMergeChoice,
  TripStopMergeDecision,
} from '../../domain/trip/conflicts'
import type { TripStop } from '../../domain/trip/types'

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
  const [mergeSelections, setMergeSelections] = useState<
    Record<string, Record<string, TripStopMergeChoice>>
  >({})
  const bulkUseLocalLabel =
    categoryFilter === 'missing-remote' ? 'Upload to Drive' : 'Use Local'

  const mergePairsByConflict = useMemo(() => {
    const next: Record<string, StopPair[]> = {}
    conflicts.forEach((conflict) => {
      if (!isMergeableConflict(conflict)) return
      const localStops = conflict.local?.stops ?? []
      const remoteStops = conflict.incoming?.stops ?? []
      next[conflict.id] = buildStopPairs(localStops, remoteStops)
    })
    return next
  }, [conflicts])

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

  const handleMergeSelection = (
    conflictId: string,
    pairId: string,
    choice: TripStopMergeChoice,
  ) => {
    setMergeSelections((prev) => ({
      ...prev,
      [conflictId]: {
        ...prev[conflictId],
        [pairId]: choice,
      },
    }))
  }

  const isMergeSelectionComplete = (conflictId: string) => {
    if (selections[conflictId] !== 'merge') return true
    const pairs = mergePairsByConflict[conflictId] ?? []
    if (pairs.length === 0) return true
    const choices = mergeSelections[conflictId] ?? {}
    return pairs.every((pair) => Boolean(choices[pair.id]))
  }

  const handleApply = () => {
    const decisions: TripConflictDecision[] = conflicts
      .filter((conflict) => selections[conflict.id])
      .map((conflict) => {
        const action = selections[conflict.id]
        const decision: TripConflictDecision = {
          conflictId: conflict.id,
          action,
        }

        if (action === 'merge') {
          const pairs = mergePairsByConflict[conflict.id] ?? []
          const selectionsForConflict = mergeSelections[conflict.id] ?? {}
          const stopMergeDecisions: TripStopMergeDecision[] = pairs
            .filter((pair) => selectionsForConflict[pair.id])
            .map((pair) => ({
              localStopId: pair.local?.id,
              remoteStopId: pair.remote?.id,
              choice: selectionsForConflict[pair.id],
            }))

          decision.stopMergeDecisions = stopMergeDecisions
        }

        return decision
      })

    if (decisions.length > 0) {
      onResolve(decisions)
    }
  }

  const allSelected = conflicts.every(
    (conflict) => Boolean(selections[conflict.id]) && isMergeSelectionComplete(conflict.id),
  )
  const selectedCount = conflicts.filter((c) => Boolean(selections[c.id])).length
  const hasSelections = selectedCount > 0
  const hasIncompleteMerge = conflicts.some(
    (conflict) => selections[conflict.id] === 'merge' && !isMergeSelectionComplete(conflict.id),
  )

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
            {hasIncompleteMerge ? ' Merge selections are still incomplete.' : ''}
          </span>
        </div>

        <div className="unified-conflict-bulk-actions">
          <span>Select all:</span>
          <button
            type="button"
            className="ghost ghost--small"
            onClick={() => handleSelectAll('use-local')}
          >
            {bulkUseLocalLabel}
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
              mergePairs={mergePairsByConflict[conflict.id]}
              mergeSelections={mergeSelections[conflict.id]}
              onMergeSelect={handleMergeSelection}
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
  mergePairs?: StopPair[]
  mergeSelections?: Record<string, TripStopMergeChoice>
  onMergeSelect: (conflictId: string, pairId: string, choice: TripStopMergeChoice) => void
  onSelect: (conflictId: string, action: TripConflictAction) => void
}

function ConflictCard({
  conflict,
  selected,
  mergePairs,
  mergeSelections,
  onMergeSelect,
  onSelect,
}: ConflictCardProps) {
  const categoryLabel = getCategoryLabel(conflict.category)
  const hasLocal = Boolean(conflict.local)
  const hasIncoming = Boolean(conflict.incoming)
  const canMerge = Boolean(
    hasLocal &&
      hasIncoming &&
      mergePairs &&
      mergePairs.length > 0 &&
      isMergeableCategory(conflict.category),
  )

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
            <span>{getUseLocalLabel(conflict.category)}</span>
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
            {canMerge && (
              <label className="conflict-action-radio">
                <input
                  type="radio"
                  name={`conflict-${conflict.id}`}
                  checked={selected === 'merge'}
                  onChange={() => onSelect(conflict.id, 'merge')}
                />
                <span>Merge per stop</span>
              </label>
            )}
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

      {selected === 'merge' && canMerge && mergePairs ? (
        <div className="merge-panel">
          <div className="merge-panel-header">
            Choose which version of each stop to keep.
          </div>
          <div className="merge-panel-list">
            {mergePairs.map((pair) => (
              <div key={pair.id} className="merge-row">
                <div className="merge-stop">
                  <div className="merge-stop-label">Local</div>
                  {pair.local ? (
                    <>
                      <div className="merge-stop-title">{pair.local.label}</div>
                      <div className="merge-stop-meta">{pair.local.address}</div>
                      <div className="merge-stop-meta">
                        {formatStopDateRange(pair.local)}
                      </div>
                    </>
                  ) : (
                    <div className="merge-stop-empty">Not in Local</div>
                  )}
                </div>

                <div className="merge-stop">
                  <div className="merge-stop-label">Drive</div>
                  {pair.remote ? (
                    <>
                      <div className="merge-stop-title">{pair.remote.label}</div>
                      <div className="merge-stop-meta">{pair.remote.address}</div>
                      <div className="merge-stop-meta">
                        {formatStopDateRange(pair.remote)}
                      </div>
                    </>
                  ) : (
                    <div className="merge-stop-empty">Not in Drive</div>
                  )}
                </div>

                <div className="merge-choice">
                  <span className="merge-choice-label">Keep</span>
                  <div className="merge-choice-group">
                    {pair.local && (
                      <label>
                        <input
                          type="radio"
                          name={`merge-${conflict.id}-${pair.id}`}
                          checked={mergeSelections?.[pair.id] === 'local'}
                          onChange={() => onMergeSelect(conflict.id, pair.id, 'local')}
                        />
                        Local
                      </label>
                    )}
                    {pair.remote && (
                      <label>
                        <input
                          type="radio"
                          name={`merge-${conflict.id}-${pair.id}`}
                          checked={mergeSelections?.[pair.id] === 'remote'}
                          onChange={() => onMergeSelect(conflict.id, pair.id, 'remote')}
                        />
                        Drive
                      </label>
                    )}
                    <label>
                      <input
                        type="radio"
                        name={`merge-${conflict.id}-${pair.id}`}
                        checked={mergeSelections?.[pair.id] === 'skip'}
                        onChange={() => onMergeSelect(conflict.id, pair.id, 'skip')}
                      />
                      Skip
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

type StopPair = {
  id: string
  local?: TripStop
  remote?: TripStop
  matchType: 'id' | 'fuzzy' | 'unmatched'
}

const MERGEABLE_CATEGORIES: TripConflictCategory[] = [
  'remote-newer',
  'local-newer',
  'checksum-mismatch',
]

function isMergeableCategory(category: TripConflictCategory): boolean {
  return MERGEABLE_CATEGORIES.includes(category)
}

function isMergeableConflict(conflict: TripConflict): boolean {
  return (
    isMergeableCategory(conflict.category) &&
    Boolean(conflict.local?.stops) &&
    Boolean(conflict.incoming?.stops)
  )
}

function buildStopPairs(localStops: TripStop[], remoteStops: TripStop[]): StopPair[] {
  const pairs: StopPair[] = []
  const remoteById = new Map(remoteStops.map((stop) => [stop.id, stop]))
  const usedRemoteIds = new Set<string>()

  localStops.forEach((local) => {
    const remote = remoteById.get(local.id)
    if (!remote) return
    usedRemoteIds.add(remote.id)
    pairs.push({
      id: `id-${local.id}`,
      local,
      remote,
      matchType: 'id',
    })
  })

  const remainingLocals = localStops.filter((stop) => !remoteById.has(stop.id))
  const remainingRemotes = remoteStops.filter((stop) => !usedRemoteIds.has(stop.id))
  const remoteByKey = new Map<string, TripStop[]>()

  remainingRemotes.forEach((remote) => {
    const key = createStopKey(remote)
    const existing = remoteByKey.get(key) ?? []
    existing.push(remote)
    remoteByKey.set(key, existing)
  })

  remainingLocals.forEach((local) => {
    const key = createStopKey(local)
    const matches = remoteByKey.get(key)
    if (matches && matches.length > 0) {
      const remote = matches.shift() as TripStop
      usedRemoteIds.add(remote.id)
      pairs.push({
        id: `fuzzy-${local.id}-${remote.id}`,
        local,
        remote,
        matchType: 'fuzzy',
      })
      return
    }

    pairs.push({
      id: `local-${local.id}`,
      local,
      matchType: 'unmatched',
    })
  })

  remainingRemotes.forEach((remote) => {
    if (usedRemoteIds.has(remote.id)) return
    pairs.push({
      id: `remote-${remote.id}`,
      remote,
      matchType: 'unmatched',
    })
  })

  return pairs
}

function createStopKey(stop: TripStop): string {
  return [
    normalizeKey(stop.label),
    normalizeKey(stop.address),
    stop.startDate,
    stop.endDate,
  ].join('|')
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase()
}

function formatStopDateRange(stop: TripStop): string {
  if (stop.startDate === stop.endDate) return stop.startDate
  return `${stop.startDate} - ${stop.endDate}`
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

function getUseLocalLabel(category: TripConflictCategory): string {
  if (category === 'missing-remote') {
    return 'Upload to Drive'
  }

  return 'Use Local'
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
