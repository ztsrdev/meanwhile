import { existsSync } from 'node:fs'
import { loadConfig } from '../engine/config.js'
import { readAway } from '../engine/away.js'
import { underConductor } from '../engine/env.js'
import { configPath } from '../engine/paths.js'
import { listSessions, readMeta } from '../engine/state.js'
import { probeAutomation } from '../platform/index.js'
import { detectEnvironment } from '../detect.js'
import { inspectCodexHooks } from './codex-hooks.js'
import { consoleIO, type CommandIO } from './io.js'
import { codexHooksPath, vendoredBundlePath } from './paths.js'
import { runExternal, type ProcessRunner } from './process.js'
import { VERSION } from './version.js'

export interface StatusOptions {
  io?: CommandIO
  runner?: ProcessRunner
  now?: number
}

function formatAge(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h`
  }
  return `${Math.floor(hours / 24)}d`
}

async function reportClaude(
  executable: string | null,
  runner: ProcessRunner,
  io: CommandIO,
): Promise<void> {
  if (!executable) {
    io.stdout('✗ Claude: CLI not found; plugin status unavailable')
    return
  }
  const result = await runner(executable, ['plugin', 'list'])
  if (result.skipped) {
    io.stdout('⚠ Claude: CLI found; plugin check skipped (dry-run)')
  } else if (result.exitCode !== 0) {
    io.stdout('⚠ Claude: CLI found; `claude plugin list` failed')
  } else if (/meanwhile/i.test(`${result.stdout}\n${result.stderr}`)) {
    io.stdout('✓ Claude: CLI found; meanwhile plugin installed')
  } else {
    io.stdout('✗ Claude: CLI found; meanwhile plugin not installed')
  }
}

async function reportCodex(
  executable: string | null,
  runner: ProcessRunner,
  io: CommandIO,
): Promise<void> {
  const cli = executable ? '✓ CLI found' : '✗ CLI not found'
  const inspection = inspectCodexHooks()
  const hooks = inspection.present
    ? `✓ all four hooks present in ${codexHooksPath()}`
    : inspection.error
      ? `✗ hooks unreadable: ${inspection.error}`
      : `✗ hooks incomplete (${inspection.events.length}/4) in ${codexHooksPath()}`
  const bundlePath = vendoredBundlePath()
  const bundleExists = existsSync(bundlePath)
  const bundle = bundleExists
    ? `✓ bundle present at ${bundlePath}`
    : `✗ bundle missing at ${bundlePath}`
  io.stdout(`Codex: ${cli}; ${hooks}; ${bundle}`)

  if (bundleExists) {
    const result = await runner(process.execPath, [bundlePath, 'version'])
    if (result.skipped) {
      io.stdout(
        `⚠ Codex bundle version: comparison with CLI ${VERSION} skipped (dry-run)`,
      )
    } else if (result.exitCode !== 0) {
      io.stdout('⚠ Codex bundle version: unable to read vendored version')
    } else {
      const vendoredVersion = result.stdout.trim().split(/\r?\n/, 1)[0]
      if (vendoredVersion === VERSION) {
        io.stdout(`✓ Codex bundle version matches CLI ${VERSION}`)
      } else {
        io.stdout(
          `⚠ Codex bundle version skew: installed ${vendoredVersion || 'unknown'}, CLI ${VERSION}`,
        )
      }
    }
  }
  io.stdout(
    '⚠ Codex hook trust cannot be verified externally; open Codex and run /hooks once.',
  )
}

async function reportAutomationProbe(
  io: CommandIO,
): Promise<void> {
  if (process.platform !== 'darwin') {
    io.stdout('Automation probe: not applicable (macOS only)')
    return
  }

  const result = await probeAutomation()
  switch (result) {
    case 'granted':
      io.stdout('✓ Automation probe: granted')
      break
    case 'denied':
      io.stdout('✗ Automation probe: denied')
      break
    case 'skipped':
      io.stdout('⚠ Automation probe: skipped (dry-run)')
      break
    case 'inconclusive':
      io.stdout('⚠ Automation probe: inconclusive')
      break
    case 'not-applicable':
      io.stdout('Automation probe: not applicable (macOS only)')
      break
  }
}

async function reportLinuxTool(
  tool: string,
  runner: ProcessRunner,
  io: CommandIO,
): Promise<void> {
  const result = await runner('which', [tool])
  if (result.skipped) {
    io.stdout(`⚠ Linux tool ${tool}: PATH check skipped (dry-run)`)
  } else if (result.exitCode === 0) {
    io.stdout(`✓ Linux tool ${tool}: on PATH`)
  } else {
    io.stdout(`✗ Linux tool ${tool}: not found on PATH`)
  }
}

async function reportPlatform(
  runner: ProcessRunner,
  io: CommandIO,
): Promise<void> {
  if (process.platform === 'linux') {
    if (process.env.WAYLAND_DISPLAY !== undefined) {
      io.stdout(
        '⚠ Linux display: Wayland; window detection and activation are unavailable',
      )
    } else if (process.env.DISPLAY) {
      io.stdout('✓ Linux display: X11; window control is available with X11 tools')
    } else {
      io.stdout(
        '✗ Linux display: no X11 display detected; window detection and activation are unavailable',
      )
    }
    for (const tool of [
      'xdg-open',
      'xdotool',
      'wmctrl',
      'notify-send',
    ]) {
      await reportLinuxTool(tool, runner, io)
    }
  } else if (process.platform === 'win32') {
    io.stdout(
      '⚠ Windows platform: experimental; application activation is best effort',
    )
  }
}

export async function runStatus(options: StatusOptions = {}): Promise<void> {
  const io = options.io ?? consoleIO
  const runner = options.runner ?? runExternal
  const now = options.now ?? Date.now()

  try {
    const detection = await detectEnvironment({ runner })
    await reportClaude(detection.claude.path, runner, io)
    await reportCodex(detection.codex.path, runner, io)

    io.stdout(
      detection.conductor.found
        ? `✓ Conductor: app found; ${underConductor() ? 'running inside a Conductor workspace' : 'current environment is outside a Conductor workspace'}`
        : `✗ Conductor: app not found; ${underConductor() ? 'CONDUCTOR_* environment detected' : 'no CONDUCTOR_* environment detected'}`,
    )

    const config = loadConfig()
    io.stdout(`Config: ${configPath()}`)
    io.stdout(`  url=${config.url}`)
    io.stdout(`  delaySeconds=${config.delaySeconds}`)
    io.stdout(`  browser=${config.browser}`)
    io.stdout(
      `  pullBack.enabled=${config.pullBack.enabled}, multiSession=${config.pullBack.multiSession}, notification=${config.pullBack.notification}, sound=${config.pullBack.sound}`,
    )
    io.stdout(
      `  conductor.suppressAlerts=${config.conductor.suppressAlerts}`,
    )

    const sessions = listSessions()
    if (sessions.length === 0) {
      io.stdout('✓ State: no live sessions')
    } else {
      io.stdout(`State: ${sessions.length} live session(s)`)
      for (const id of sessions) {
        const meta = readMeta(id)
        if (!meta) {
          io.stdout(`  ⚠ ${id}: metadata unavailable`)
          continue
        }
        const state = meta.busySince === null ? 'idle' : 'busy'
        io.stdout(
          `  ${id}: ${state}, ${meta.harness}, age ${formatAge(now - meta.updatedAt)}`,
        )
      }
    }

    const away = readAway(now)
    if (away) {
      io.stdout(
        `⚠ Away marker: owner ${away.owner}, age ${formatAge(now - away.since)}`,
      )
    } else {
      io.stdout('✓ Away marker: none')
    }

    await reportPlatform(runner, io)
    await reportAutomationProbe(io)
  } catch (error) {
    io.stdout(`⚠ Status report incomplete: ${String(error)}`)
  }
}
