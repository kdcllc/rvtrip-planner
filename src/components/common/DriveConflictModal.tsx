import type { DriveConflict } from '../../hooks/useGoogleDriveSync'

interface DriveConflictModalProps {
  conflicts: DriveConflict[]
  onResolve: (conflict: DriveConflict, action: 'use-local' | 'use-drive' | 'ignore') => void
}

export function DriveConflictModal({ conflicts, onResolve }: DriveConflictModalProps) {
  if (conflicts.length === 0) return null

  return (
    <div className="drive-conflict-backdrop" role="dialog" aria-modal="true">
      <div className="drive-conflict-modal">
        <h2>Resolve Drive conflicts</h2>
        <p className="drive-conflict-subtitle">
          Trips changed in multiple places. Choose how to resolve each before syncing.
        </p>
        <div className="drive-conflict-list">
          {conflicts.map((conflict) => (
            <div key={conflict.id} className="drive-conflict-card">
              <div className="drive-conflict-info">
                <strong>{conflict.tripName}</strong>
                {conflict.localUpdatedAt ? (
                  <span>
                    Local updated: {formatTimestamp(conflict.localUpdatedAt)}
                  </span>
                ) : (
                  <span>Not found locally</span>
                )}
                <span>
                  Drive updated: {formatTimestamp(conflict.remoteUpdatedAt)}
                </span>
              </div>
              <div className="drive-conflict-actions">
                {conflict.type === 'remote-only' ? (
                  <>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => onResolve(conflict, 'use-drive')}
                    >
                      Import from Drive
                    </button>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => onResolve(conflict, 'ignore')}
                    >
                      Ignore
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => onResolve(conflict, 'use-drive')}
                    >
                      Use Drive
                    </button>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => onResolve(conflict, 'use-local')}
                    >
                      Keep local
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function formatTimestamp(value?: string): string {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
