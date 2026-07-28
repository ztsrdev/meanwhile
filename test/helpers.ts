import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config, NormalizedEvent } from '../src/types.js'

export function createTestHome(): string {
  const directory = mkdtempSync(join(tmpdir(), 'meanwhile-test-'))
  process.env.MEANWHILE_HOME = directory
  process.env.MEANWHILE_DRYRUN = '1'
  return directory
}

export function removeTestHome(directory: string): void {
  rmSync(directory, { recursive: true, force: true })
  delete process.env.MEANWHILE_HOME
  delete process.env.MEANWHILE_DRYRUN
}

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesBelow(path) : [path]
  })
}

export function ensureFreshBundle(): void {
  const root = process.cwd()
  const bundlePath = join(root, 'dist', 'meanwhile.mjs')
  const inputs = [
    ...filesBelow(join(root, 'src')),
    join(root, 'scripts', 'bundle.mjs'),
    join(root, 'package.json'),
    join(root, 'package-lock.json'),
  ]
  const newestInput = Math.max(...inputs.map((path) => statSync(path).mtimeMs))
  if (existsSync(bundlePath) && statSync(bundlePath).mtimeMs >= newestInput) {
    return
  }

  const result = spawnSync(
    process.execPath,
    [join(root, 'scripts', 'bundle.mjs')],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
  if (result.status !== 0) {
    throw new Error(`Bundle build failed: ${result.stderr || result.stdout}`)
  }
}

export function withoutConductorEnvironment(): () => void {
  const entries = Object.entries(process.env).filter(([key]) => key.startsWith('CONDUCTOR_'))
  for (const [key] of entries) {
    delete process.env[key]
  }
  return () => {
    for (const [key, value] of entries) {
      if (value !== undefined) {
        process.env[key] = value
      }
    }
  }
}

export function config(
  multiSession: Config['pullBack']['multiSession'] = 'all-idle',
): Config {
  return {
    url: 'https://www.duolingo.com/learn',
    delaySeconds: 20,
    browser: 'auto',
    pullBack: {
      enabled: true,
      multiSession,
      notification: true,
      sound: false,
    },
    conductor: {
      suppressAlerts: true,
    },
  }
}

export function event(
  sessionId: string,
  kind: NormalizedEvent['kind'],
  overrides: Partial<NormalizedEvent> = {},
): NormalizedEvent {
  return {
    harness: 'claude',
    kind,
    sessionId,
    cwd: '/tmp/project',
    stopHookActive: false,
    ...overrides,
  }
}
