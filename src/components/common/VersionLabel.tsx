import { APP_VERSION, formatVersionLabel } from '../../config/version'

export function VersionLabel() {
  return (
    <small data-testid="app-version" title={APP_VERSION.buildTime}>
      {formatVersionLabel(APP_VERSION)}
    </small>
  )
}
