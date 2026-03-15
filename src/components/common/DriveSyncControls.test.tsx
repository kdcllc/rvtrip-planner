import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DriveSyncControls } from './DriveSyncControls'

const noop = vi.fn()

describe('DriveSyncControls', () => {
  it('renders reconnect state after session expiry', () => {
    const markup = renderToStaticMarkup(
      <DriveSyncControls
        authStatus="reconnect-required"
        syncStatus="idle"
        lastSyncAt={null}
        error="Google session expired. Reconnect to keep syncing."
        isOnline={true}
        hasClientId={true}
        gisReady={true}
        userInfo={null}
        onSignIn={noop}
        onSignOut={noop}
        onSyncNow={noop}
      />,
    )

    expect(markup).toContain('Google Drive session expired')
    expect(markup).toContain('Reconnect Google Drive')
    expect(markup).toContain('Google session expired. Reconnect to keep syncing.')
  })

  it('renders connected account details when signed in', () => {
    const markup = renderToStaticMarkup(
      <DriveSyncControls
        authStatus="signed-in"
        syncStatus="idle"
        lastSyncAt={null}
        error={null}
        isOnline={true}
        hasClientId={true}
        gisReady={true}
        userInfo={{ email: 'traveler@example.com' }}
        onSignIn={noop}
        onSignOut={noop}
        onSyncNow={noop}
      />,
    )

    expect(markup).toContain('Google Drive connected as traveler@example.com')
    expect(markup).toContain('Sync now')
    expect(markup).toContain('Sign out')
  })
})