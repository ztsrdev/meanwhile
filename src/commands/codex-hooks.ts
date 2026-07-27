import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { isDryRun } from '../engine/env.js'
import { atomicWriteFile } from '../engine/fs.js'
import { appendLog } from '../engine/log.js'
import { backupRoot, codexHooksPath, vendoredBundlePath } from './paths.js'

export const CODEX_EVENTS = [
  'UserPromptSubmit',
  'Stop',
  'PermissionRequest',
  'SessionEnd',
] as const

type JsonObject = Record<string, unknown>

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readHooks(path: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!isRecord(parsed)) {
      throw new Error('hooks root must be an object')
    }
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw new Error(`Cannot read Codex hooks at ${path}: ${String(error)}`)
  }
}

// Codex only loads events nested under a top-level "hooks" key (verified
// empirically against codex-cli 0.144.1: top-level event keys are ignored).
function looksLikeHookGroups(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((group) => isRecord(group) && Array.isArray(group.hooks))
  )
}

function shellArgument(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`
}

export function codexHookCommand(
  bundlePath: string = vendoredBundlePath(),
): string {
  return `node ${shellArgument(bundlePath)} hook --harness codex`
}

export function isMeanwhileCommand(
  command: unknown,
  bundlePath: string = vendoredBundlePath(),
): boolean {
  if (typeof command !== 'string') {
    return false
  }
  const normalized = command.replaceAll('\\', '/')
  const normalizedBundle = bundlePath.replaceAll('\\', '/')
  return (
    normalized.includes(normalizedBundle) ||
    normalized.includes('.meanwhile/bin/meanwhile.mjs') ||
    (normalized.includes('meanwhile.mjs') &&
      normalized.includes('hook --harness codex')) ||
    (normalized.includes('awaitlingo.mjs') &&
      normalized.includes('hook --harness codex'))
  )
}

function filterMeanwhileHooks(
  groups: unknown,
  bundlePath: string,
): { groups: unknown; found: boolean } {
  if (!Array.isArray(groups)) {
    return { groups, found: false }
  }

  let found = false
  const filteredGroups: unknown[] = []
  for (const group of groups) {
    if (!isRecord(group) || !Array.isArray(group.hooks)) {
      filteredGroups.push(group)
      continue
    }

    const hooks = group.hooks.filter((hook) => {
      const ours =
        isRecord(hook) && isMeanwhileCommand(hook.command, bundlePath)
      found ||= ours
      return !ours
    })
    if (hooks.length > 0) {
      filteredGroups.push({ ...group, hooks })
    }
  }
  return { groups: filteredGroups, found }
}

export function backupCodexHooks(
  sourcePath: string = codexHooksPath(),
  timestamp: Date = new Date(),
): string | null {
  if (!existsSync(sourcePath)) {
    return null
  }
  const destination = join(
    backupRoot(),
    timestamp.toISOString(),
    'hooks.json',
  )
  if (isDryRun()) {
    appendLog(`dryrun: would copy ${sourcePath} to ${destination}`)
    return destination
  }
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(sourcePath, destination)
  return destination
}

export interface HooksMutationResult {
  path: string
  backupPath: string | null
  changed: boolean
}

export function mergeCodexHooks(
  path: string = codexHooksPath(),
  bundlePath: string = vendoredBundlePath(),
): HooksMutationResult {
  const backupPath = backupCodexHooks(path)
  const root = readHooks(path)
  const container = isRecord(root.hooks) ? root.hooks : {}

  // Heal legacy layouts (event groups at the root, which Codex ignores) by
  // moving them under the wrapper while preserving foreign entries.
  for (const key of Object.keys(root)) {
    if (key === 'hooks' || !looksLikeHookGroups(root[key])) {
      continue
    }
    const existing = Array.isArray(container[key])
      ? (container[key] as unknown[])
      : []
    container[key] = [...existing, ...(root[key] as unknown[])]
    delete root[key]
  }

  const command = codexHookCommand(bundlePath)
  for (const event of CODEX_EVENTS) {
    const filtered = filterMeanwhileHooks(container[event], bundlePath)
    const groups = Array.isArray(filtered.groups) ? filtered.groups : []
    container[event] = [
      ...groups,
      {
        hooks: [
          {
            type: 'command',
            command,
            timeout: 10,
          },
        ],
      },
    ]
  }
  root.hooks = container

  if (isDryRun()) {
    appendLog(`dryrun: would write Codex hooks ${path}`)
  } else {
    atomicWriteFile(path, `${JSON.stringify(root, null, 2)}\n`)
  }
  return { path, backupPath, changed: true }
}

export function removeCodexHooks(
  path: string = codexHooksPath(),
  bundlePath: string = vendoredBundlePath(),
): HooksMutationResult {
  if (!existsSync(path)) {
    return { path, backupPath: null, changed: false }
  }

  const backupPath = backupCodexHooks(path)
  const root = readHooks(path)
  let changed = false
  const scopes: JsonObject[] = [root]
  if (isRecord(root.hooks)) {
    scopes.push(root.hooks)
  }
  for (const scope of scopes) {
    for (const event of Object.keys(scope)) {
      if (scope === root && event === 'hooks') {
        continue
      }
      const filtered = filterMeanwhileHooks(scope[event], bundlePath)
      if (filtered.found) {
        scope[event] = filtered.groups
        changed = true
      }
    }
  }

  if (changed) {
    if (isDryRun()) {
      appendLog(`dryrun: would write Codex hooks ${path}`)
    } else {
      atomicWriteFile(path, `${JSON.stringify(root, null, 2)}\n`)
    }
  }
  return { path, backupPath, changed }
}

export function inspectCodexHooks(
  path: string = codexHooksPath(),
  bundlePath: string = vendoredBundlePath(),
): { present: boolean; events: readonly string[]; error?: string } {
  if (!existsSync(path)) {
    return { present: false, events: [] }
  }
  try {
    const root = readHooks(path)
    const legacyLayout = CODEX_EVENTS.some((event) =>
      looksLikeHookGroups(root[event]),
    )
    const hooks = isRecord(root.hooks) ? root.hooks : {}
    const events = CODEX_EVENTS.filter((event) => {
      const groups = hooks[event]
      return (
        Array.isArray(groups) &&
        groups.some(
          (group) =>
            isRecord(group) &&
            Array.isArray(group.hooks) &&
            group.hooks.some(
              (hook) =>
                isRecord(hook) &&
                hook.type === 'command' &&
                hook.command === codexHookCommand(bundlePath) &&
                hook.timeout === 10 &&
                !Object.hasOwn(hook, 'async'),
            ),
        )
      )
    })
    const present = events.length === CODEX_EVENTS.length
    if (!present && legacyLayout) {
      return {
        present,
        events,
        error:
          'legacy unwrapped hooks layout detected (Codex ignores it); run `meanwhile install` to repair',
      }
    }
    return { present, events }
  } catch (error) {
    return { present: false, events: [], error: String(error) }
  }
}
