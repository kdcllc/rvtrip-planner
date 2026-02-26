const DRIVE_FILE_MAP_KEY = 'trip-planner-drive-file-map'
const DRIVE_CHECKSUMS_KEY = 'trip-planner-drive-checksums'
const DRIVE_TRIP_NAMES_KEY = 'trip-planner-drive-trip-names'
const DRIVE_QUEUE_KEY = 'trip-planner-drive-queue'
const DRIVE_IGNORED_KEY = 'trip-planner-drive-ignored'
const DRIVE_DEVICE_ID_KEY = 'trip-planner-drive-device-id'
const DRIVE_LAST_SYNCED_KEY = 'trip-planner-drive-last-synced'

export function loadDriveFileMap(): Record<string, string> {
  try {
    const stored = window.localStorage.getItem(DRIVE_FILE_MAP_KEY)
    if (!stored) return {}
    const parsed = JSON.parse(stored) as Record<string, string>
    return parsed ?? {}
  } catch {
    return {}
  }
}

export function saveDriveFileMap(map: Record<string, string>): void {
  try {
    window.localStorage.setItem(DRIVE_FILE_MAP_KEY, JSON.stringify(map))
  } catch {
    // Ignore storage failures
  }
}

export function loadDriveChecksums(): Record<string, string> {
  try {
    const stored = window.localStorage.getItem(DRIVE_CHECKSUMS_KEY)
    if (!stored) return {}
    const parsed = JSON.parse(stored) as Record<string, string>
    return parsed ?? {}
  } catch {
    return {}
  }
}

export function saveDriveChecksums(checksums: Record<string, string>): void {
  try {
    window.localStorage.setItem(DRIVE_CHECKSUMS_KEY, JSON.stringify(checksums))
  } catch {
    // Ignore storage failures
  }
}

export function loadDriveTripNames(): Record<string, string> {
  try {
    const stored = window.localStorage.getItem(DRIVE_TRIP_NAMES_KEY)
    if (!stored) return {}
    const parsed = JSON.parse(stored) as Record<string, string>
    return parsed ?? {}
  } catch {
    return {}
  }
}

export function saveDriveTripNames(names: Record<string, string>): void {
  try {
    window.localStorage.setItem(DRIVE_TRIP_NAMES_KEY, JSON.stringify(names))
  } catch {
    // Ignore storage failures
  }
}

export function loadDriveQueue(): string[] {
  try {
    const stored = window.localStorage.getItem(DRIVE_QUEUE_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored) as string[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveDriveQueue(queue: string[]): void {
  try {
    window.localStorage.setItem(DRIVE_QUEUE_KEY, JSON.stringify(queue))
  } catch {
    // Ignore storage failures
  }
}

export function loadDriveIgnoredTripIds(): string[] {
  try {
    const stored = window.localStorage.getItem(DRIVE_IGNORED_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored) as string[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveDriveIgnoredTripIds(ids: string[]): void {
  try {
    window.localStorage.setItem(DRIVE_IGNORED_KEY, JSON.stringify(ids))
  } catch {
    // Ignore storage failures
  }
}

export function loadDriveDeviceId(): string | null {
  try {
    return window.localStorage.getItem(DRIVE_DEVICE_ID_KEY)
  } catch {
    return null
  }
}

export function saveDriveDeviceId(value: string): void {
  try {
    window.localStorage.setItem(DRIVE_DEVICE_ID_KEY, value)
  } catch {
    // Ignore storage failures
  }
}

export function loadDriveLastSyncedAtMap(): Record<string, string> {
  try {
    const stored = window.localStorage.getItem(DRIVE_LAST_SYNCED_KEY)
    if (!stored) return {}
    const parsed = JSON.parse(stored) as Record<string, string>
    return parsed ?? {}
  } catch {
    return {}
  }
}

export function saveDriveLastSyncedAtMap(map: Record<string, string>): void {
  try {
    window.localStorage.setItem(DRIVE_LAST_SYNCED_KEY, JSON.stringify(map))
  } catch {
    // Ignore storage failures
  }
}
