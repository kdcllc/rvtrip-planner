import type { VersionInfo } from '../types/version'

export const APP_VERSION: VersionInfo = {
  version: __APP_VERSION__,
  commit: __APP_COMMIT__,
  buildTime: __APP_BUILD_TIME__,
}

export function formatVersionLabel(info: VersionInfo): string {
  return `v${info.version} (${info.commit})`
}
