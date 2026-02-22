const TOKEN_STORAGE_KEY = 'trip-planner-drive-token'
const TOKEN_EXPIRY_KEY = 'trip-planner-drive-token-expiry'

export function saveAccessToken(token: string, expiresInSeconds?: number): void {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
    if (expiresInSeconds) {
      const expiryTime = Date.now() + expiresInSeconds * 1000
      window.localStorage.setItem(TOKEN_EXPIRY_KEY, String(expiryTime))
    }
  } catch {
    // Ignore storage failures
  }
}

export function loadAccessToken(): string | null {
  try {
    const token = window.localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!token) return null

    const expiryTimeStr = window.localStorage.getItem(TOKEN_EXPIRY_KEY)
    if (expiryTimeStr) {
      const expiryTime = parseInt(expiryTimeStr, 10)
      if (Date.now() >= expiryTime) {
        // Token expired
        clearAccessToken()
        return null
      }
    }

    return token
  } catch {
    return null
  }
}

export function getTokenExpiryTime(): number | null {
  try {
    const expiryTimeStr = window.localStorage.getItem(TOKEN_EXPIRY_KEY)
    if (!expiryTimeStr) return null
    return parseInt(expiryTimeStr, 10)
  } catch {
    return null
  }
}

export function isTokenNearExpiry(bufferSeconds = 300): boolean {
  const expiryTime = getTokenExpiryTime()
  if (!expiryTime) return false
  // Refresh if token expires within buffer (default 5 minutes)
  return Date.now() + bufferSeconds * 1000 >= expiryTime
}

export function clearAccessToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY)
    window.localStorage.removeItem(TOKEN_EXPIRY_KEY)
  } catch {
    // Ignore storage failures
  }
}
