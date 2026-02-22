/// <reference types="vite/client" />
/// <reference types="google.maps" />

declare global {
  interface Window {
    gm_authFailure?: () => void
    google?: typeof google
    __googleMapsCallback?: () => void
  }
}

declare namespace google.accounts.oauth2 {
  interface TokenClient {
    requestAccessToken: (options?: { prompt?: string }) => void
  }

  interface TokenResponse {
    access_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }

  function initTokenClient(options: {
    client_id: string
    scope: string
    callback: (response: TokenResponse) => void
  }): TokenClient

  function revoke(token: string, callback?: () => void): void
}

export {}
