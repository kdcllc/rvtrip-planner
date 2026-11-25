import type { VersionInfo } from '../../types/version'

const isString = (v: unknown): v is string => typeof v === 'string'

export async function fetchDeployedVersion(
  fetchImpl: typeof fetch = fetch,
): Promise<VersionInfo | null> {
  try {
    const res = await fetchImpl('/version.json', { cache: 'no-store' })
    if (!res.ok) return null
    const data: unknown = await res.json()
    if (typeof data !== 'object' || data === null) return null
    const { version, commit, buildTime } = data as Record<string, unknown>
    if (!isString(version) || !isString(commit) || !isString(buildTime)) return null
    return { version, commit, buildTime }
  } catch {
    return null
  }
}

export function isNewVersion(current: VersionInfo, deployed: VersionInfo): boolean {
  return current.version !== deployed.version || current.commit !== deployed.commit
}
