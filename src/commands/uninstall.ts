import { rmSync } from 'node:fs'
import os from 'node:os'
import { resolve } from 'node:path'
import { isDryRun } from '../engine/env.js'
import { appendLog } from '../engine/log.js'
import { home } from '../engine/paths.js'
import { detectEnvironment } from '../detect.js'
import { removeCodexHooks } from './codex-hooks.js'
import { consoleIO, type CommandIO } from './io.js'
import { runExternal, type ProcessRunner } from './process.js'

export interface UninstallOptions {
  purge: boolean
  yes: boolean
  io?: CommandIO
  runner?: ProcessRunner
}

function processFailure(
  label: string,
  result: { exitCode: number; stderr: string; skipped: boolean },
  io: CommandIO,
): void {
  if (result.exitCode === 0) {
    io.stdout(
      result.skipped ? `✓ ${label} planned (dry-run)` : `✓ ${label}`,
    )
  } else {
    io.stderr(
      `⚠ ${label} failed; continuing: ${result.stderr.trim() || `exit ${result.exitCode}`}`,
    )
  }
}

function purgeHome(target: string): void {
  const resolved = resolve(target)
  if (resolved === '/' || resolved === resolve(os.homedir())) {
    throw new Error(`Refusing to purge unsafe meanwhile home: ${resolved}`)
  }
  if (isDryRun()) {
    appendLog(`dryrun: remove ${resolved}`)
    return
  }
  rmSync(resolved, { recursive: true, force: true })
}

export async function runUninstall(
  options: UninstallOptions,
): Promise<void> {
  const io = options.io ?? consoleIO
  const runner = options.runner ?? runExternal
  const detection = await detectEnvironment({
    probeCodex: false,
    runner,
  })

  if (detection.claude.found && detection.claude.path) {
    const plugin = await runner(detection.claude.path, [
      'plugin',
      'uninstall',
      'meanwhile',
    ])
    processFailure('Claude plugin uninstall', plugin, io)

    const marketplace = await runner(detection.claude.path, [
      'plugin',
      'marketplace',
      'remove',
      'meanwhile',
    ])
    processFailure('Claude marketplace removal', marketplace, io)
  } else {
    io.stdout('- Claude CLI not found; plugin removal skipped')
  }

  try {
    const mutation = removeCodexHooks()
    if (mutation.changed) {
      io.stdout(
        isDryRun()
          ? `✓ (dry-run) would write ${mutation.path} without meanwhile entries`
          : `✓ Removed meanwhile entries from ${mutation.path}`,
      )
    } else {
      io.stdout(`- No meanwhile Codex hooks found at ${mutation.path}`)
    }
    if (mutation.backupPath) {
      io.stdout(
        isDryRun()
          ? `✓ (dry-run) would write a Codex hooks backup to ${mutation.backupPath}`
          : `✓ Backed up Codex hooks to ${mutation.backupPath}`,
      )
    }
  } catch (error) {
    io.stderr(`⚠ Codex hook removal failed; continuing: ${String(error)}`)
  }

  if (options.purge) {
    const confirmed =
      options.yes ||
      (await io.confirm(
        `Delete all meanwhile config and state at ${home()}? [y/N] `,
        false,
      ))
    if (confirmed) {
      purgeHome(home())
      io.stdout(
        isDryRun()
          ? `✓ Purge planned for ${home()} (dry-run)`
          : `✓ Deleted ${home()}`,
      )
    } else {
      io.stdout('- Config and state retained')
    }
  } else {
    io.stdout(`- Config and state retained at ${home()}`)
  }
}
