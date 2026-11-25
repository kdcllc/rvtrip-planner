import type { VersionInfo } from '../../types/version'

export const APP_VERSION_STORAGE_KEY = 'tripPlanner.appVersion'

const isCacheKey = (key: string): boolean =>
  key.startsWith('tripPlanner.') && key.includes('.cache.')

export function resetCachesOnVersionChange(
  current: VersionInfo,
  storage?: Storage,
): boolean {
  try {
    const store = storage ?? localStorage
    const marker = `${current.version}+${current.commit}`
    if (store.getItem(APP_VERSION_STORAGE_KEY) === marker) return false
    const keys: string[] = []
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (key !== null && isCacheKey(key)) keys.push(key)
    }
    keys.forEach((key) => store.removeItem(key))
    store.setItem(APP_VERSION_STORAGE_KEY, marker)
    return true
  } catch {
    return false
  }
}
