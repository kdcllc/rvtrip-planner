// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../..')

// Patterns are assembled from parts so this file never matches its own scan.
const g = 'goo' + 'gle'
const RULES: { name: string; pattern: RegExp }[] = [
  { name: `${g}apis host`, pattern: new RegExp(`${g}apis\\.com`) },
  { name: 'gstatic host', pattern: /gstatic\.com/ },
  { name: 'X-Goog header', pattern: /X-Goog-/ },
  { name: `${g} maps link`, pattern: new RegExp(`${g}\\.com/maps`) },
  { name: `${g} maps text`, pattern: new RegExp(`${g} maps`, 'i') },
]

export function findLeftovers(text: string): string[] {
  return RULES.filter((r) => r.pattern.test(text)).map((r) => r.name)
}

const isTestFile = (p: string) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /(^|[\\/])__tests__[\\/]/.test(p)

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

function targets(): string[] {
  const files = walk(join(ROOT, 'src'))
  for (const f of ['index.html', 'staticwebapp.config.json', 'public/robots.txt']) {
    const full = join(ROOT, f)
    if (existsSync(full)) files.push(full)
  }
  return files.filter((f) => !isTestFile(relative(ROOT, f)))
}

const TEXT_EXT = /\.(tsx?|jsx?|css|html|json|txt|svg|md)$/i

describe('no leftover Google routing, fonts or map links', () => {
  it('matcher fires on sample strings', () => {
    expect(findLeftovers(`https://routes.${g}apis.com/x`)).toContain(`${g}apis host`)
    expect(findLeftovers('https://fonts.gstatic.com/s')).toContain('gstatic host')
    expect(findLeftovers('X-Goog-Api-Key')).toContain('X-Goog header')
    expect(findLeftovers(`https://www.${g}.com/maps/dir`)).toContain(`${g} maps link`)
    expect(findLeftovers(`Open in ${g.toUpperCase()} Maps`)).toContain(`${g} maps text`)
    expect(findLeftovers('nothing to see here')).toEqual([])
  })

  it('scans a non-trivial set of files', () => {
    expect(targets().length).toBeGreaterThan(10)
  })

  it('finds no leftovers in src, index.html, staticwebapp.config.json, robots.txt', () => {
    const hits: string[] = []
    for (const file of targets()) {
      if (!TEXT_EXT.test(file)) continue
      const found = findLeftovers(readFileSync(file, 'utf8'))
      if (found.length) hits.push(`${relative(ROOT, file)}: ${found.join(', ')}`)
    }
    expect(hits).toEqual([])
  })
})
