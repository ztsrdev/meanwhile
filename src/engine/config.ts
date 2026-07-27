import { readFileSync } from 'node:fs'
import type { Config } from '../types.js'
import { isDryRun } from './env.js'
import { atomicWriteFile } from './fs.js'
import { appendLog } from './log.js'
import { configPath } from './paths.js'

export const DEFAULT_CONFIG: Config = {
  url: 'https://www.duolingo.com/learn',
  delaySeconds: 20,
  browser: 'auto',
  pullBack: {
    enabled: true,
    multiSession: 'all-idle',
    notification: true,
    sound: false,
  },
  conductor: {
    suppressAlerts: true,
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface ConfigRule {
  isValid(value: unknown): boolean
  expected: string
}

const CONFIG_RULES: Readonly<Record<string, ConfigRule>> = {
  url: {
    isValid: (value) => typeof value === 'string',
    expected: 'a string',
  },
  delaySeconds: {
    isValid: (value) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0,
    expected: 'a non-negative finite number',
  },
  browser: {
    isValid: (value) =>
      value === 'auto' || value === 'chrome' || value === 'default',
    expected: 'auto|chrome|default',
  },
  'pullBack.enabled': {
    isValid: (value) => typeof value === 'boolean',
    expected: 'a boolean',
  },
  'pullBack.multiSession': {
    isValid: (value) =>
      value === 'all-idle' || value === 'any-finishes',
    expected: 'all-idle|any-finishes',
  },
  'pullBack.notification': {
    isValid: (value) => typeof value === 'boolean',
    expected: 'a boolean',
  },
  'pullBack.sound': {
    isValid: (value) => typeof value === 'boolean',
    expected: 'a boolean',
  },
  'conductor.suppressAlerts': {
    isValid: (value) => typeof value === 'boolean',
    expected: 'a boolean',
  },
}

export function validateConfigValue(
  path: string,
  value: unknown,
): string | null {
  const rule = CONFIG_RULES[path]
  if (!rule) {
    return 'a known configuration value'
  }
  return rule.isValid(value) ? null : rule.expected
}

function validOrDefault<T>(path: string, value: unknown, fallback: T): T {
  return validateConfigValue(path, value) === null ? (value as T) : fallback
}

function mergeConfig(value: Record<string, unknown>): Config {
  const pullBack = isRecord(value.pullBack) ? value.pullBack : {}
  const conductor = isRecord(value.conductor) ? value.conductor : {}

  return {
    url: validOrDefault('url', value.url, DEFAULT_CONFIG.url),
    delaySeconds: validOrDefault(
      'delaySeconds',
      value.delaySeconds,
      DEFAULT_CONFIG.delaySeconds,
    ),
    browser: validOrDefault('browser', value.browser, DEFAULT_CONFIG.browser),
    pullBack: {
      enabled: validOrDefault(
        'pullBack.enabled',
        pullBack.enabled,
        DEFAULT_CONFIG.pullBack.enabled,
      ),
      multiSession: validOrDefault(
        'pullBack.multiSession',
        pullBack.multiSession,
        DEFAULT_CONFIG.pullBack.multiSession,
      ),
      notification: validOrDefault(
        'pullBack.notification',
        pullBack.notification,
        DEFAULT_CONFIG.pullBack.notification,
      ),
      sound: validOrDefault(
        'pullBack.sound',
        pullBack.sound,
        DEFAULT_CONFIG.pullBack.sound,
      ),
    },
    conductor: {
      suppressAlerts: validOrDefault(
        'conductor.suppressAlerts',
        conductor.suppressAlerts,
        DEFAULT_CONFIG.conductor.suppressAlerts,
      ),
    },
  }
}

export function loadConfig(): Config {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath(), 'utf8'))
    if (!isRecord(parsed)) {
      throw new Error('configuration root must be an object')
    }
    return mergeConfig(parsed)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      appendLog(`config: ignored corrupt configuration: ${String(error)}`)
    }
    return mergeConfig({})
  }
}

export function saveConfig(config: Config): boolean {
  const path = configPath()
  if (isDryRun()) {
    appendLog(`dryrun: would write config ${path}`)
    return false
  }
  atomicWriteFile(path, `${JSON.stringify(config, null, 2)}\n`)
  return true
}
