const TOKEN_STORAGE_KEY = 'trip-planner-drive-token'
const TOKEN_EXPIRY_KEY = 'trip-planner-drive-token-expiry'
const USER_INFO_KEY = 'trip-planner-drive-user'

export type DriveUserInfo = {
  sub?: string
  email?: string
  name?: string
  picture?: string
}

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

export function saveDriveUserInfo(userInfo: DriveUserInfo | null): void {
  try {
    if (!userInfo) {
      window.localStorage.removeItem(USER_INFO_KEY)
      return
    }

    window.localStorage.setItem(USER_INFO_KEY, JSON.stringify(userInfo))
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

export function loadDriveUserInfo(): DriveUserInfo | null {
  try {
    const raw = window.localStorage.getItem(USER_INFO_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DriveUserInfo
    return parsed && typeof parsed === 'object' ? parsed : null
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
    window.localStorage.removeItem(USER_INFO_KEY)
  } catch {
    // Ignore storage failures
  }
}
