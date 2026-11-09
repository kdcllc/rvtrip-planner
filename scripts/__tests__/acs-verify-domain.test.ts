// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = process.env.ACS_VERIFY_SCRIPT_OVERRIDE ?? resolve(__dirname, '../acs-verify-domain.sh')

// Fake az: logs argv (one line per call) and returns canned output per subcommand.
const FAKE_AZ = `#!/bin/sh
echo "$*" >> "$AZ_LOG"
case "$1 $2" in
  "account show") [ "$FAKE_ACCOUNT_FAIL" = "1" ] && exit 1; echo '{}'; exit 0 ;;
  "extension add") exit 0 ;;
esac
case "$*" in
  *"email domain show"*)
    case "$*" in
      *verificationStates.DKIM2.status*) echo "$FAKE_DKIM2" ;;
      *verificationStates.DKIM.status*) echo "$FAKE_DKIM" ;;
      *verificationStates.SPF.status*) echo "$FAKE_SPF" ;;
      *verificationStates.Domain.status*) echo "$FAKE_DOMAIN" ;;
    esac
    exit 0 ;;
  *"initiate-verification"*)
    [ "$FAKE_INIT_FAIL" = "1" ] && exit 1
    exit 0 ;;
esac
exit 0
`

describe.skipIf(process.platform === 'win32')('acs-verify-domain.sh', () => {
  let dir: string
  let log: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acs-verify-'))
    log = join(dir, 'az.log')
    const azPath = join(dir, 'az')
    writeFileSync(azPath, FAKE_AZ)
    chmodSync(azPath, 0o755)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function run(extra: Record<string, string> = {}) {
    const r = spawnSync('sh', [SCRIPT], {
      encoding: 'utf8',
      env: {
        PATH: `${dir}:/usr/bin:/bin`,
        AZ_LOG: log,
        AZURE_CUSTOM_EMAIL_DOMAIN: 'example.com',
        AZURE_EMAIL_SERVICE_NAME: 'email-svc',
        AZURE_RESOURCE_GROUP: 'rg-test',
        FAKE_DOMAIN: 'Verified',
        FAKE_SPF: 'Verified',
        FAKE_DKIM: 'Verified',
        FAKE_DKIM2: 'Verified',
        ...extra,
      },
    })
    const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []
    return { code: r.status, out: r.stdout + r.stderr, calls }
  }

  const initiates = (calls: string[]) => calls.filter((c) => c.includes('initiate-verification'))

  it('(a) skips with exit 0 and never calls az when the domain is empty', () => {
    const r = run({ AZURE_CUSTOM_EMAIL_DOMAIN: '' })
    expect(r.code).toBe(0)
    expect(r.out).toContain('skipped')
    expect(r.calls).toEqual([])
    expect(existsSync(log)).toBe(false)
  })

  it('(b) skips with exit 0 and no initiate-verification when az is not logged in', () => {
    const r = run({ FAKE_ACCOUNT_FAIL: '1' })
    expect(r.code).toBe(0)
    expect(r.out).toContain('skipped: az not logged in')
    expect(r.calls.some((c) => c.startsWith('account show'))).toBe(true)
    expect(initiates(r.calls)).toEqual([])
  })

  it('(c) initiates verification exactly for DKIM and DKIM2 when only they are unverified', () => {
    const r = run({ FAKE_DKIM: 'NotStarted', FAKE_DKIM2: 'NotStarted' })
    expect(r.code).toBe(0)
    const init = initiates(r.calls)
    expect(init).toHaveLength(2)
    expect(init.filter((c) => /--verification-type DKIM$/.test(c))).toHaveLength(1)
    expect(init.filter((c) => /--verification-type DKIM2$/.test(c))).toHaveLength(1)
    expect(r.out).toContain('example.com DKIM: NotStarted')
    expect(r.out).toContain('not all verified yet')
  })

  it('(d) makes no initiate call and points at USE_CUSTOM_EMAIL_DOMAIN when all are Verified', () => {
    const r = run()
    expect(r.code).toBe(0)
    expect(initiates(r.calls)).toEqual([])
    expect(r.out).toContain('all verified')
    expect(r.out).toContain('USE_CUSTOM_EMAIL_DOMAIN')
  })

  it('(e) still exits 0 and prints a warning when initiate-verification fails', () => {
    const r = run({ FAKE_DKIM: 'NotStarted', FAKE_DKIM2: 'NotStarted', FAKE_INIT_FAIL: '1' })
    expect(r.code).toBe(0)
    expect(initiates(r.calls)).toHaveLength(2)
    expect(r.out).toContain('warning: could not initiate DKIM verification')
    expect(r.out).toContain('warning: could not initiate DKIM2 verification')
  })
})
