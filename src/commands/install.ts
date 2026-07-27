import {
  existsSync,
  readFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_CONFIG, saveConfig } from '../engine/config.js'
import { isDryRun } from '../engine/env.js'
import { atomicWriteFile } from '../engine/fs.js'
import { appendLog } from '../engine/log.js'
import { configPath } from '../engine/paths.js'
import {
  describeCliDetection,
  detectEnvironment,
  type DetectionReport,
} from '../detect.js'
import { mergeCodexHooks } from './codex-hooks.js'
import { consoleIO, type CommandIO } from './io.js'
import { resolveRepoRoot, vendoredBundlePath } from './paths.js'
import {
  runExternal,
  type ProcessResult,
  type ProcessRunner,
} from './process.js'

export interface InstallOptions {
  yes: boolean
  claudeOnly: boolean
  codexOnly: boolean
  io?: CommandIO
  runner?: ProcessRunner
  detection?: DetectionReport
  repoRoot?: string
}

function idempotentClaudeSuccess(result: ProcessResult): boolean {
  if (result.exitCode === 0) {
    return true
  }
  return /already\s+(?:exists|added|installed)|already.*(?:marketplace|plugin)/i.test(
    `${result.stdout}\n${result.stderr}`,
  )
}

async function installClaude(
  executable: string,
  repoRoot: string,
  runner: ProcessRunner,
  io: CommandIO,
): Promise<boolean> {
  const marketplace = await runner(executable, [
    'plugin',
    'marketplace',
    'add',
    repoRoot,
  ])
  if (!idempotentClaudeSuccess(marketplace)) {
    io.stderr(
      `✗ Claude marketplace add failed: ${marketplace.stderr.trim() || `exit ${marketplace.exitCode}`}`,
    )
    return false
  }

  const plugin = await runner(executable, [
    'plugin',
    'install',
    'meanwhile@meanwhile',
  ])
  if (!idempotentClaudeSuccess(plugin)) {
    io.stderr(
      `✗ Claude plugin install failed: ${plugin.stderr.trim() || `exit ${plugin.exitCode}`}`,
    )
    return false
  }

  io.stdout(
    marketplace.skipped || plugin.skipped
      ? '✓ Claude Code wiring planned (dry-run)'
      : '✓ Claude Code plugin installed',
  )
  return true
}

export function vendorBundle(
  repoRoot: string,
  destination: string = vendoredBundlePath(),
): void {
  const source = join(repoRoot, 'dist', 'meanwhile.mjs')
  if (isDryRun()) {
    appendLog(`dryrun: would copy ${source} to ${destination}`)
    return
  }
  if (!existsSync(source)) {
    throw new Error(
      `Built bundle not found at ${source}; run npm run build before installing`,
    )
  }

  atomicWriteFile(destination, readFileSync(source), 0o755)
}

type DefaultConfigResult = 'existing' | 'written' | 'planned'

function ensureDefaultConfig(): DefaultConfigResult {
  if (!existsSync(configPath())) {
    return saveConfig(DEFAULT_CONFIG) ? 'written' : 'planned'
  }
  return 'existing'
}

export async function runInstall(options: InstallOptions): Promise<boolean> {
  if (options.claudeOnly && options.codexOnly) {
    throw new Error('--claude-only and --codex-only cannot be used together')
  }

  const io = options.io ?? consoleIO
  const runner = options.runner ?? runExternal
  const detection =
    options.detection ??
    (await detectEnvironment({
      probeClaude: !options.codexOnly,
      probeCodex: !options.claudeOnly,
      runner,
    }))

  io.stdout('Detected integrations:')
  io.stdout(
    describeCliDetection(
      'Claude Code',
      detection.claude,
      options.codexOnly,
    ),
  )
  io.stdout(
    describeCliDetection('Codex CLI', detection.codex, options.claudeOnly),
  )
  io.stdout(
    detection.conductor.found
      ? `- Conductor: found at ${detection.conductor.path}`
      : `- Conductor: not found at ${detection.conductor.path}`,
  )

  const repoRoot = options.repoRoot ?? resolveRepoRoot()
  let succeeded = true
  if (!options.codexOnly && detection.claude.found && detection.claude.path) {
    const confirmed =
      options.yes ||
      (await io.confirm('Wire up Claude Code? [Y/n] ', true))
    if (confirmed) {
      succeeded =
        (await installClaude(
          detection.claude.path,
          repoRoot,
          runner,
          io,
        )) && succeeded
    } else {
      io.stdout('- Claude Code skipped')
    }
  }

  if (!options.claudeOnly && detection.codex.found) {
    const confirmed =
      options.yes || (await io.confirm('Wire up Codex CLI? [Y/n] ', true))
    if (confirmed) {
      try {
        const destination = vendoredBundlePath()
        vendorBundle(repoRoot, destination)
        const mutation = mergeCodexHooks(undefined, destination)
        io.stdout(
          isDryRun()
            ? `✓ (dry-run) would write Codex hooks to ${mutation.path} and copy the bundle to ${destination}`
            : `✓ Codex hooks installed at ${mutation.path}`,
        )
      } catch (error) {
        io.stderr(`✗ Codex install failed: ${String(error)}`)
        succeeded = false
      }
    } else {
      io.stdout('- Codex CLI skipped')
    }
  }

  const configResult = ensureDefaultConfig()
  io.stdout(
    configResult === 'planned'
      ? `✓ (dry-run) would write default config to ${configPath()}`
      : `✓ Config ready at ${configPath()}`,
  )
  io.stdout('')
  io.stdout('Next steps:')
  if (!options.claudeOnly) {
    io.stdout(
      '⚠ Open Codex and run /hooks once to review and trust the installed hooks.',
    )
  }
  io.stdout(
    '⚠ macOS may show a one-time “wants to control Google Chrome” Automation dialog; approve it for browser switching.',
  )
  io.stdout('Run `meanwhile status` to verify the installation.')
  return succeeded
}
