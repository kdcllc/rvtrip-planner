import { useVersionCheck } from '../../hooks/useVersionCheck'
import './UpdateBanner.css'

export function UpdateBanner() {
  const { updateAvailable, reload } = useVersionCheck()
  if (!updateAvailable) return null
  return (
    <div className="update-banner" role="status" aria-live="polite">
      <span>New version available</span>
      <button type="button" className="update-banner__button" onClick={reload}>
        Reload
      </button>
    </div>
  )
}
