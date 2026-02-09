/// <reference types="vite/client" />
/// <reference types="google.maps" />

declare global {
  interface Window {
    gm_authFailure?: () => void
    google?: any
    __googleMapsCallback?: () => void
  }
}

export {}
