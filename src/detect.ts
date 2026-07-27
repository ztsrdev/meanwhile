import { existsSync } from 'node:fs'
import { findExecutable } from './commands/paths.js'
import {
  runExternal,
  type ProcessResult,
  type ProcessRunner,
} from './commands/process.js'

export interface CliDetection {
  found: boolean
  path: string | null
  version: string | null
  versionSkipped: boolean
}

export interface DetectionReport {
  claude: CliDetection
  codex: CliDetection
  conductor: {
    found: boolean
    path: string
  }
}

export interface DetectOptions {
  probeClaude?: boolean
  probeCodex?: boolean
  runner?: ProcessRunner
  find?: (name: string) => string | null
  conductorPath?: string
}

async function detectCli(
  name: 'claude' | 'codex',
  enabled: boolean,
  runner: ProcessRunner,
  find: (name: string) => string | null,
): Promise<CliDetection> {
  if (!enabled) {
    return {
      found: false,
      path: null,
      version: null,
      versionSkipped: true,
    }
  }

  const executable = find(name)
  if (!executable) {
    return {
      found: false,
      path: null,
      version: null,
      versionSkipped: false,
    }
  }

  let result: ProcessResult
  try {
    result = await runner(executable, ['--version'])
  } catch {
    result = {
      stdout: '',
      stderr: '',
      exitCode: 1,
      skipped: false,
    }
  }
  const output = `${result.stdout}\n${result.stderr}`.trim()
  return {
    found: true,
    path: executable,
    version: result.exitCode === 0 && output ? output.split(/\r?\n/, 1)[0] : null,
    versionSkipped: result.skipped,
  }
}

export async function detectEnvironment(
  options: DetectOptions = {},
): Promise<DetectionReport> {
  const runner = options.runner ?? runExternal
  const find = options.find ?? findExecutable
  const conductorPath = options.conductorPath ?? '/Applications/Conductor.app'
  const [claude, codex] = await Promise.all([
    detectCli('claude', options.probeClaude !== false, runner, find),
    detectCli('codex', options.probeCodex !== false, runner, find),
  ])

  return {
    claude,
    codex,
    conductor: {
      found: existsSync(conductorPath),
      path: conductorPath,
    },
  }
}

export function describeCliDetection(
  label: string,
  detection: CliDetection,
  intentionallySkipped = false,
): string {
  if (intentionallySkipped) {
    return `- ${label}: skipped by selection`
  }
  if (!detection.found) {
    return `- ${label}: not found`
  }
  if (detection.version) {
    return `- ${label}: ${detection.version} (${detection.path})`
  }
  if (detection.versionSkipped) {
    return `- ${label}: found at ${detection.path} (version skipped in dry-run)`
  }
  return `- ${label}: found at ${detection.path} (version unavailable)`
}
