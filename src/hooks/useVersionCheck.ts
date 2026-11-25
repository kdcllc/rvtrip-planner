import { useCallback, useEffect, useState } from 'react'
import { APP_VERSION } from '../config/version'
import { fetchDeployedVersion, isNewVersion } from '../services/version/versionCheck'

export const VERSION_POLL_INTERVAL_MS = 5 * 60 * 1000

export interface UseVersionCheckOptions {
  enabled?: boolean
  intervalMs?: number
}

/**
 * Polls for a newer deployed version on an interval and when the tab regains
 * focus/visibility. Never reloads automatically.
 */
export function useVersionCheck(options: UseVersionCheckOptions = {}): {
  updateAvailable: boolean
  reload: () => void
} {
  const { enabled = !import.meta.env.DEV, intervalMs = VERSION_POLL_INTERVAL_MS } = options
  const [updateAvailable, setUpdateAvailable] = useState(false)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    let found = false
    let timer: ReturnType<typeof setInterval> | undefined

    const stop = () => {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', check)
    }

    const check = () => {
      if (cancelled || found) return
      void fetchDeployedVersion().then((deployed) => {
        if (cancelled || found || deployed === null) return
        if (isNewVersion(APP_VERSION, deployed)) {
          found = true
          setUpdateAvailable(true)
          stop()
        }
      })
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') check()
    }

    check()
    timer = setInterval(check, intervalMs)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', check)

    return () => {
      cancelled = true
      stop()
    }
  }, [enabled, intervalMs])

  const reload = useCallback(() => {
    window.location.reload()
  }, [])

  return { updateAvailable, reload }
}
