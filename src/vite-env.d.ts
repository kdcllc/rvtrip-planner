/// <reference types="vite/client" />
/// <reference types="google.maps" />

declare global {
  interface Window {
    gm_authFailure?: () => void
    google?: typeof google
    __googleMapsCallback?: () => void
  }
}

export {}
