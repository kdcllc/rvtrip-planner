const GIS_SRC = 'https://accounts.google.com/gsi/client'

let gisPromise: Promise<void> | null = null

export function loadGoogleIdentityServices(): Promise<void> {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve()
  }

  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${GIS_SRC}"]`)
      if (existing) {
        existing.addEventListener('load', () => resolve())
        existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services')))
        return
      }

      const script = document.createElement('script')
      script.src = GIS_SRC
      script.async = true
      script.defer = true
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Failed to load Google Identity Services'))
      document.head.appendChild(script)
    })
  }

  return gisPromise
}

export function revokeGoogleAccess(token: string): Promise<void> {
  if (!window.google?.accounts?.oauth2) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    window.google?.accounts?.oauth2?.revoke(token, () => resolve())
  })
}
