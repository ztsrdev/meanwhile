import {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  validateConfigValue,
} from '../engine/config.js'
import type { Config } from '../types.js'
import { consoleIO, type CommandIO } from './io.js'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function leafPaths(value: unknown, prefix = ''): string[] {
  if (!isRecord(value)) {
    return [prefix]
  }
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  )
}

export const VALID_CONFIG_KEYS = leafPaths(DEFAULT_CONFIG).sort()

function assertValidPath(path: string): void {
  if (!VALID_CONFIG_KEYS.includes(path)) {
    throw new Error(
      `Unknown config path "${path}". Valid keys: ${VALID_CONFIG_KEYS.join(', ')}`,
    )
  }
}

function getPath(root: unknown, path: string): unknown {
  let current = root
  for (const part of path.split('.')) {
    if (!isRecord(current)) {
      return undefined
    }
    current = current[part]
  }
  return current
}

function setPath(root: JsonRecord, path: string, value: unknown): void {
  const parts = path.split('.')
  let current = root
  for (const part of parts.slice(0, -1)) {
    const child = current[part]
    if (!isRecord(child)) {
      throw new Error(`Cannot set config path "${path}"`)
    }
    current = child
  }
  const leaf = parts.at(-1)
  if (!leaf) {
    throw new Error(`Cannot set config path "${path}"`)
  }
  current[leaf] = value
}

export function coerceConfigValue(value: string): string | number | boolean {
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  if (
    value.trim() !== '' &&
    /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(value)
  ) {
    const number = Number(value)
    if (Number.isFinite(number)) {
      return number
    }
  }
  return value
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function configGet(path: string): unknown {
  assertValidPath(path)
  return getPath(loadConfig(), path)
}

export function configSet(path: string, rawValue: string): unknown {
  assertValidPath(path)
  const value = coerceConfigValue(rawValue)
  const expected = validateConfigValue(path, value)
  if (expected !== null) {
    throw new Error(
      `Invalid value for "${path}": expected ${expected}, got ${formatValue(value)}`,
    )
  }

  const config = structuredClone(loadConfig()) as Config & JsonRecord
  setPath(config, path, value)
  saveConfig(config)
  return value
}

export function configEntries(): Array<readonly [string, unknown]> {
  const config = loadConfig()
  return VALID_CONFIG_KEYS.map((path) => [path, getPath(config, path)] as const)
}

export function runConfig(
  args: readonly string[],
  io: CommandIO = consoleIO,
): void {
  const [action, path, value, ...extra] = args
  if (action === 'get' && path && value === undefined) {
    io.stdout(formatValue(configGet(path)))
    return
  }
  if (
    action === 'set' &&
    path &&
    value !== undefined &&
    extra.length === 0
  ) {
    io.stdout(`${path}=${formatValue(configSet(path, value))}`)
    return
  }
  if (action === 'list' && path === undefined) {
    for (const [key, entry] of configEntries()) {
      io.stdout(`${key}=${formatValue(entry)}`)
    }
    return
  }
  throw new Error(
    'Usage: awaitlingo config <get <dot.path>|set <dot.path> <value>|list>',
  )
}
