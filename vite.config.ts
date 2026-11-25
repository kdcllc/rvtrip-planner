import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function resolveCommit(): string {
  const sha = process.env.GITHUB_SHA?.trim()
  if (sha) return sha.slice(0, 7)
  try {
    const out = execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
    return out || 'unknown'
  } catch {
    return 'unknown'
  }
}

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string }

const versionInfo = {
  version: pkg.version,
  commit: resolveCommit(),
  buildTime: new Date().toISOString(),
}

function versionJsonPlugin(): Plugin {
  return {
    name: 'emit-version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify(versionInfo),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionJsonPlugin()],
  worker: { format: 'es' },
  define: {
    __APP_VERSION__: JSON.stringify(versionInfo.version),
    __APP_COMMIT__: JSON.stringify(versionInfo.commit),
    __APP_BUILD_TIME__: JSON.stringify(versionInfo.buildTime),
  },
  // @ts-expect-error - Vitest config extends Vite config
  test: {
    globals: true,
    environment: 'node',
  },
})
