import type { DriveAuthStatus, DriveSyncStatus } from '../../hooks/useGoogleDriveSync'
import type { DriveUserInfo } from '../../services/drive/tokenStorage'

interface DriveSyncControlsProps {
  authStatus: DriveAuthStatus
  syncStatus: DriveSyncStatus
  lastSyncAt: string | null
  error: string | null
  isOnline: boolean
  hasClientId: boolean
  gisReady?: boolean
  userInfo?: DriveUserInfo | null
  onSignIn: () => void
  onSignOut: () => void
  onSyncNow: () => void
}

export function DriveSyncControls({
  authStatus,
  syncStatus,
  lastSyncAt,
  error,
  isOnline,
  hasClientId,
  gisReady = true,
  userInfo,
  onSignIn,
  onSignOut,
  onSyncNow,
}: DriveSyncControlsProps) {
  const formattedLastSync = lastSyncAt
    ? new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(lastSyncAt))
    : null
  const connectedLabel = userInfo?.email ?? userInfo?.name
  const reconnectRequired = authStatus === 'reconnect-required'
  const statusText = reconnectRequired
    ? 'Google Drive session expired'
    : `Google Drive connected${connectedLabel ? ` as ${connectedLabel}` : ''}`
  const connectLabel = reconnectRequired ? 'Reconnect Google Drive' : 'Connect Google Drive'

  return (
    <div className="drive-sync">
      <div>
        {authStatus === 'signed-in' ? (
          <>
            <span className="drive-sync-status">{statusText}</span>
            <button
              className="ghost"
              type="button"
              onClick={onSyncNow}
              disabled={syncStatus === 'syncing'}
            >
              {syncStatus === 'syncing' ? '🔄 Syncing…' : '🔄 Sync now'}
            </button>
            <button className="ghost" type="button" onClick={onSignOut}>
              🚪 Sign out
            </button>
          </>
        ) : (
          <>
            {reconnectRequired ? <span className="drive-sync-status">{statusText}</span> : null}
            <button
              className="ghost"
              type="button"
              onClick={onSignIn}
              disabled={!hasClientId || !gisReady || authStatus === 'loading'}
            >
              {authStatus === 'loading' ? '🔌 Connecting…' : `🔌 ${connectLabel}`}
            </button>
          </>
        )}
      </div>

      <div>
        {!hasClientId ? (
          <span className="drive-sync-meta" title="Set VITE_GOOGLE_DRIVE_CLIENT_ID in .env">
            Missing Drive client ID
          </span>
        ) : (
          <span className="drive-sync-meta">{isOnline ? 'Online' : 'Offline'}</span>
        )}

        {formattedLastSync ? (
          <span className="drive-sync-meta">Last sync {formattedLastSync}</span>
        ) : null}

        {error ? <span className="drive-sync-error">{error}</span> : null}
      </div>
    </div>
  )
}
