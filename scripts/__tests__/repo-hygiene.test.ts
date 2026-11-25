// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Repo-hygiene guard: fails when a secret-bearing file becomes tracked, an ignore rule or the
// secret-scan guard is removed, or a required community file goes missing.
// The override exists only so a regression proof can point the suite at a scratch tree.
const ROOT = process.env.REPO_HYGIENE_ROOT_OVERRIDE ?? resolve(__dirname, '../..')

const MAX_SCAN_BYTES = 1024 * 1024

// ---------- pure checking logic ----------

/** Paths that must never be tracked: env files (except the example), azd state, local settings, key material. */
export function findForbiddenTrackedFiles(paths: string[]): string[] {
  return paths.filter((p) => {
    const path = p.replace(/\\/g, '/')
    const name = basename(path)
    if (name === '.env') return true
    if (name.startsWith('.env.') && name !== '.env.example') return true
    if (/(^|\/)\.azure\//.test(path)) return true
    if (path === 'api/local.settings.json') return true
    return /\.(pem|pfx|key)$/i.test(name)
  })
}

// Patterns are assembled from parts so this file holds no literal that a secret scanner
// (or this suite's own scan) would match.
const GOOGLE_KEY_PREFIX = ['AI', 'za'].join('')
const OAUTH_HOST = ['apps', 'googleusercontent', 'com'].join('.')
/** Escapes backslashes and dots so the text can sit literally inside a RegExp source. */
export function escapeHost(host: string): string {
  return host.replace(/[\\.]/g, '\\$&')
}
const IDENTIFIER_RULES: { name: string; pattern: RegExp }[] = [
  { name: 'google-api-key', pattern: new RegExp(`${GOOGLE_KEY_PREFIX}[0-9A-Za-z_-]{35}`) },
  {
    name: 'google-oauth-client-id',
    pattern: new RegExp(`[0-9]+-[0-9A-Za-z_]+\\.${escapeHost(OAUTH_HOST)}`),
  },
]

/** Names of the identifier rules that match the given text (empty when clean). */
export function findIdentifierLeaks(text: string): string[] {
  return IDENTIFIER_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.name)
}

/** Paths left out of the identifier scan: vendored skills, lockfiles, memory records, test files. */
export function isScanExcluded(p: string): boolean {
  const path = p.replace(/\\/g, '/')
  if (path.startsWith('.agents/') || path.startsWith('_memory/')) return true
  if (['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml'].includes(basename(path))) return true
  return /(^|\/)__tests__\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
}

/** Required ignore rules that are absent from (or ineffective in) the .gitignore text. */
export function missingIgnoreRules(gitignore: string): string[] {
  const rules = gitignore.split(/\r?\n/).map((line) => line.trim())
  const missing = ['.env', '.azure/', 'api/local.settings.json', '!.env.example'].filter((r) => !rules.includes(r))
  // A negation only takes effect when it follows the rules it re-includes from.
  if (rules.includes('!.env.example') && rules.lastIndexOf('!.env.example') < rules.indexOf('.env')) {
    missing.push('!.env.example (must follow .env)')
  }
  return missing
}

/** Event names declared under a workflow's top-level `on:` key (block, inline list or scalar form). */
export function workflowTriggers(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/)
  const start = lines.findIndex((line) => /^(on|'on'|"on"):/.test(line))
  if (start === -1) return []
  const inline = lines[start].replace(/^[^:]+:/, '').replace(/#.*$/, '').trim()
  if (inline) return inline.replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean)
  const events: string[] = []
  let indent = -1
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const depth = line.length - line.trimStart().length
    if (depth === 0) break
    if (indent === -1) indent = depth
    const key = /^([A-Za-z_]+):/.exec(line.trim())
    if (depth === indent && key) events.push(key[1])
  }
  return events
}

// ---------- repo access (git index + filesystem, read-only) ----------

function listTrackedFiles(): { ok: true; files: string[] } | { ok: false; reason: string } {
  const probe = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, encoding: 'utf8' })
  if (probe.error) return { ok: false, reason: 'git is not available' }
  if (probe.status !== 0 || probe.stdout.trim() !== 'true') return { ok: false, reason: 'not a git work tree' }
  const ls = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (ls.status !== 0) return { ok: false, reason: 'git ls-files failed' }
  return { ok: true, files: ls.stdout.split('\0').filter(Boolean) }
}

/** Scans tracked text files only (never an untracked or ignored path); reports path and rule, never the match. */
function scanTrackedFiles(files: string[]): string[] {
  const findings: string[] = []
  for (const file of files) {
    if (isScanExcluded(file)) continue
    const abs = join(ROOT, file)
    if (!existsSync(abs)) continue // tracked but deleted in the work tree
    const stat = statSync(abs)
    if (!stat.isFile() || stat.size > MAX_SCAN_BYTES) continue
    const buffer = readFileSync(abs)
    if (buffer.subarray(0, 8000).includes(0)) continue // binary
    for (const rule of findIdentifierLeaks(buffer.toString('utf8'))) findings.push(`${file}: ${rule}`)
  }
  return findings
}

const readRepoFile = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

const tracked = listTrackedFiles()
const skipNote = tracked.ok ? '' : ` [SKIPPED: ${tracked.reason}]`
const trackedFiles = tracked.ok ? tracked.files : []

// ---------- unit tests of the checking logic ----------

describe('findForbiddenTrackedFiles', () => {
  it('flags every secret-bearing path in a violating file list', () => {
    const violating = [
      '.env',
      '.env.local',
      'api/.env.production',
      '.azure/dev/config.json',
      'infra/.azure/config.json',
      'api/local.settings.json',
      'certs/server.pem',
      'certs/site.PFX',
      'deploy/id_rsa.key',
    ]
    expect(findForbiddenTrackedFiles([...violating, 'src/main.tsx'])).toEqual(violating)
  })

  it('returns nothing for a clean file list, including look-alike names', () => {
    const clean = [
      '.env.example',
      'api/.env.example',
      'src/env.ts',
      'docs/AZURE-PREFLIGHT.md',
      'azure.yaml',
      'api/local.settings.example.json',
      'src/keyboard.ts',
      'docs/pem-notes.md',
    ]
    expect(findForbiddenTrackedFiles(clean)).toEqual([])
  })
})

describe('escapeHost', () => {
  it('escapes backslashes and dots', () => {
    expect(escapeHost('a\\b.c')).toBe('a\\\\b\\.c')
  })
})

describe('findIdentifierLeaks', () => {
  const keyShaped = GOOGLE_KEY_PREFIX + 'b'.repeat(35)
  const clientIdShaped = `${'1'.repeat(12)}-${'a1'.repeat(16)}.${OAUTH_HOST}`

  it('detects a Google API key shape', () => {
    expect(findIdentifierLeaks(`VITE_GOOGLE_MAPS_API_KEY=${keyShaped}\n`)).toEqual(['google-api-key'])
  })

  it('detects a Google OAuth client ID shape', () => {
    expect(findIdentifierLeaks(`const clientId = '${clientIdShaped}'`)).toEqual(['google-oauth-client-id'])
  })

  it('reports both rules when both shapes are present', () => {
    expect(findIdentifierLeaks(`${keyShaped}\n${clientIdShaped}`)).toEqual(['google-api-key', 'google-oauth-client-id'])
  })

  it('does not flag a key prefix followed by only 34 characters (boundary)', () => {
    expect(findIdentifierLeaks(`key: ${GOOGLE_KEY_PREFIX}${'b'.repeat(34)} end`)).toEqual([])
  })

  it('returns nothing for clean text with placeholders', () => {
    const clean = [
      'VITE_GOOGLE_MAPS_API_KEY=your-google-maps-api-key',
      `VITE_GOOGLE_CLIENT_ID=your-client-id.${OAUTH_HOST}`,
      `See https://console.cloud.google.com and the ${OAUTH_HOST} suffix.`,
    ].join('\n')
    expect(findIdentifierLeaks(clean)).toEqual([])
  })
})

describe('isScanExcluded', () => {
  it('excludes vendored skills, lockfiles, memory records and test files', () => {
    const excluded = [
      '.agents/skills/vitest/SKILL.md',
      '_memory/README.md',
      'package-lock.json',
      'api/package-lock.json',
      'scripts/__tests__/repo-hygiene.test.ts',
      'src/services/maps/googleMaps.test.ts',
      'src/features/trip/TripForm.test.tsx',
    ]
    expect(excluded.filter((p) => !isScanExcluded(p))).toEqual([])
  })

  it('keeps source, config and docs in scope', () => {
    const inScope = ['src/services/maps/googleMaps.ts', '.env.example', 'README.md', 'package.json', 'api/src/index.ts']
    expect(inScope.filter((p) => isScanExcluded(p))).toEqual([])
  })
})

describe('missingIgnoreRules', () => {
  const good = ['node_modules', '.azure/', '.env', '.env.*', '!.env.example', 'api/local.settings.json'].join('\n')

  it('returns nothing when every rule is present', () => {
    expect(missingIgnoreRules(good)).toEqual([])
  })

  it('names each removed rule', () => {
    expect(missingIgnoreRules('node_modules\n.env.*\n# .env\n')).toEqual([
      '.env',
      '.azure/',
      'api/local.settings.json',
      '!.env.example',
    ])
  })

  it('rejects a negation placed before the rule it re-includes from', () => {
    const reordered = ['!.env.example', '.env', '.azure/', 'api/local.settings.json'].join('\n')
    expect(missingIgnoreRules(reordered)).toEqual(['!.env.example (must follow .env)'])
  })
})

describe('workflowTriggers', () => {
  it('reads block-form triggers and ignores nested keys and later sections', () => {
    const yaml = 'name: x\non:\n  push:\n    branches: [master]\n  pull_request:\n\njobs:\n  scan:\n    steps: []\n'
    expect(workflowTriggers(yaml)).toEqual(['push', 'pull_request'])
  })

  it('reads inline list and scalar forms', () => {
    expect(workflowTriggers('on: [push, pull_request]\n')).toEqual(['push', 'pull_request'])
    expect(workflowTriggers('on: push\njobs: {}\n')).toEqual(['push'])
  })

  it('returns nothing when the workflow has no triggers', () => {
    expect(workflowTriggers('name: x\njobs:\n  push:\n    steps: []\n')).toEqual([])
  })
})

// ---------- checks against the real repository ----------

describe.skipIf(!tracked.ok)(`repo hygiene: tracked files${skipNote}`, () => {
  it('lists tracked files from the git index', () => {
    expect(trackedFiles).toContain('package.json')
  })

  it('tracks no env file, azd state, local settings or key material', () => {
    expect(findForbiddenTrackedFiles(trackedFiles)).toEqual([])
  })

  it('has no Google API key or OAuth client ID shape in tracked text files', () => {
    expect(scanTrackedFiles(trackedFiles)).toEqual([])
  })
})

describe('repo hygiene: ignore rules', () => {
  it('.gitignore keeps the secret rules and the .env.example negation', () => {
    expect(missingIgnoreRules(readRepoFile('.gitignore'))).toEqual([])
  })
})

describe('repo hygiene: secret-scan guard', () => {
  it('the secret-scan workflow runs gitleaks on push and pull_request', () => {
    const workflow = readRepoFile('.github/workflows/secret-scan.yml')
    expect(workflow).toMatch(/gitleaks/)
    expect(workflowTriggers(workflow)).toEqual(expect.arrayContaining(['push', 'pull_request']))
  })

  it('the gitleaks config exists and is non-empty', () => {
    expect(readRepoFile('.gitleaks.toml').trim()).not.toBe('')
  })
})

describe('repo hygiene: community files', () => {
  it('LICENSE starts with "MIT License"', () => {
    expect(readRepoFile('LICENSE').split(/\r?\n/)[0].trim()).toBe('MIT License')
  })

  it.each(['CONTRIBUTING.md', 'SECURITY.md'])('%s exists and is non-empty', (file) => {
    expect(readRepoFile(file).trim().length).toBeGreaterThan(0)
  })
})
