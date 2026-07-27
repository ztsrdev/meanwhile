import { accessSync, constants, readFileSync } from 'node:fs'
import os from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { home } from '../engine/paths.js'

export function codexHome(): string {
  return process.env.CODEX_HOME ?? join(os.homedir(), '.codex')
}

export function codexHooksPath(): string {
  return join(codexHome(), 'hooks.json')
}

export function vendoredBundlePath(): string {
  return join(home(), 'bin', 'meanwhile.mjs')
}

export function backupRoot(): string {
  return join(home(), 'backup')
}

function isMeanwhileRoot(directory: string): boolean {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(directory, 'package.json'), 'utf8'),
    )
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { name?: unknown }).name === 'meanwhile-cli'
    )
  } catch {
    return false
  }
}

export function resolveRepoRoot(moduleUrl: string = import.meta.url): string {
  let directory = dirname(fileURLToPath(moduleUrl))
  for (let depth = 0; depth < 4; depth += 1) {
    if (isMeanwhileRoot(directory)) {
      return directory
    }
    const parent = dirname(directory)
    if (parent === directory) {
      break
    }
    directory = parent
  }

  throw new Error(
    `Unable to resolve the meanwhile repository root from ${fileURLToPath(moduleUrl)}`,
  )
}

export function findExecutable(
  name: string,
  pathValue: string | undefined = process.env.PATH,
): string | null {
  if (name.includes('/')) {
    const candidate = resolve(name)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      return null
    }
  }

  for (const directory of (pathValue ?? '').split(delimiter)) {
    if (!directory) {
      continue
    }
    const candidate = join(directory, name)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Continue searching PATH.
    }
  }
  return null
}
