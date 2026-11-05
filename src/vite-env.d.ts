/// <reference types="vite/client" />

declare global {
  interface Window {
    gm_authFailure?: () => void
    google?: typeof google
    __googleMapsCallback?: () => void
  }
}

export {}
