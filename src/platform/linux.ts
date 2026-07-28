import type { Config } from '../types.js'
import {
  execute,
  type DryRunDescription,
  type ExecOptions,
  type ExecResult,
} from '../engine/exec.js'
import { appendLog } from '../engine/log.js'
import type { Platform } from './index.js'

const EXEC_TIMEOUT_MS = 5_000
const COMPLETE_SOUND =
  '/usr/share/sounds/freedesktop/stereo/complete.oga'
const CHROME_COMMANDS = ['google-chrome', 'chromium'] as const

type Execute = (
  command: string,
  args: readonly string[],
  options: ExecOptions,
) => Promise<ExecResult>

function failed(result: ExecResult): string {
  return result.stderr.trim() || `exit ${result.exitCode}`
}

export function isX11Session(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    Boolean(environment.DISPLAY) &&
    environment.WAYLAND_DISPLAY === undefined
  )
}

export function parseWmClass(output: string): string | null {
  const match = output.match(
    /^\s*WM_CLASS(?:\([^)]*\))?\s*=\s*(.+?)\s*$/m,
  )
  if (!match?.[1]) {
    return null
  }

  const values: string[] = []
  const quoted = /"((?:\\.|[^"\\])*)"/g
  for (const value of match[1].matchAll(quoted)) {
    values.push(
      (value[1] ?? '').replaceAll('\\"', '"').replaceAll('\\\\', '\\'),
    )
  }
  if (values.length >= 2 && values[0] && values[1]) {
    return `${values[0]}.${values[1]}`
  }

  const unquoted = match[1]
    .split(',')
    .map((value) => value.trim().replace(/^"|"$/g, ''))
  return unquoted.length >= 2 && unquoted[0] && unquoted[1]
    ? `${unquoted[0]}.${unquoted[1]}`
    : null
}

export class LinuxPlatform implements Platform {
  constructor(private readonly executeCommand: Execute = execute) {}

  private async run(
    command: string,
    args: readonly string[],
    dryRunDescription?: DryRunDescription,
  ): Promise<ExecResult> {
    return this.executeCommand(command, args, {
      timeoutMs: EXEC_TIMEOUT_MS,
      dryRunDescription: dryRunDescription ?? {
        action: 'execFile',
        summary: [command, ...args].join(' '),
      },
    })
  }

  private async hasTool(command: string): Promise<boolean> {
    const result = await this.run('which', [command], {
      action: 'which',
      summary: `which ${command}`,
      details: { tool: command },
    })
    return result.skipped || result.exitCode === 0
  }

  private async openWithXdg(url: string): Promise<void> {
    if (!(await this.hasTool('xdg-open'))) {
      appendLog('platform: xdg-open is unavailable; URL was not opened')
      return
    }
    const result = await this.run('xdg-open', [url])
    if (result.exitCode !== 0) {
      appendLog(`platform: xdg-open failed: ${failed(result)}`)
    }
  }

  async openOrFocusUrl(
    url: string,
    browser: Config['browser'],
  ): Promise<void> {
    if (browser !== 'chrome') {
      await this.openWithXdg(url)
      return
    }

    // Linux launchers do not offer the Chrome tab lookup used on macOS, so
    // opening here may create a duplicate tab.
    for (const command of CHROME_COMMANDS) {
      if (!(await this.hasTool(command))) {
        continue
      }
      const result = await this.run(command, [url])
      if (result.exitCode === 0) {
        return
      }
      appendLog(`platform: ${command} failed: ${failed(result)}`)
    }
    await this.openWithXdg(url)
  }

  async frontmostBundleId(): Promise<string | null> {
    if (!isX11Session()) {
      appendLog(
        'platform: frontmost window detection is unavailable outside X11',
      )
      return null
    }
    if (!(await this.hasTool('xdotool'))) {
      appendLog(
        'platform: frontmost window detection needs xdotool; returning null',
      )
      return null
    }
    if (!(await this.hasTool('xprop'))) {
      appendLog(
        'platform: frontmost window detection needs xprop; returning null',
      )
      return null
    }

    const active = await this.run('xdotool', ['getactivewindow'])
    if (active.exitCode !== 0) {
      appendLog(
        `platform: unable to read the active X11 window: ${failed(active)}`,
      )
      return null
    }
    const windowId = active.skipped
      ? '<active-window>'
      : active.stdout.trim().split(/\s+/, 1)[0]
    if (!windowId) {
      appendLog('platform: xdotool returned no active X11 window')
      return null
    }

    const property = await this.run('xprop', [
      '-id',
      windowId,
      'WM_CLASS',
    ])
    if (property.exitCode !== 0) {
      appendLog(
        `platform: unable to read the active window WM_CLASS: ${failed(property)}`,
      )
      return null
    }
    if (property.skipped) {
      return null
    }

    const wmClass = parseWmClass(property.stdout)
    if (wmClass === null) {
      appendLog('platform: active X11 window has no parseable WM_CLASS')
    }
    return wmClass
  }

  async activateApp(target: string): Promise<void> {
    if (!isX11Session()) {
      appendLog('platform: application activation is unavailable outside X11')
      return
    }

    if (await this.hasTool('wmctrl')) {
      const result = await this.run('wmctrl', ['-x', '-a', target])
      if (result.exitCode !== 0) {
        appendLog(
          `platform: wmctrl could not activate ${target}: ${failed(result)}`,
        )
      }
      return
    }

    if (!(await this.hasTool('xdotool'))) {
      appendLog(
        'platform: application activation needs wmctrl or xdotool; no-op',
      )
      return
    }
    const search = await this.run('xdotool', [
      'search',
      '--class',
      target,
    ])
    if (search.exitCode !== 0) {
      appendLog(
        `platform: xdotool could not find ${target}: ${failed(search)}`,
      )
      return
    }
    const windowId = search.skipped
      ? '<matching-window>'
      : search.stdout.trim().split(/\s+/, 1)[0]
    if (!windowId) {
      appendLog(`platform: xdotool found no window for ${target}`)
      return
    }
    const activation = await this.run('xdotool', [
      'windowactivate',
      windowId,
    ])
    if (activation.exitCode !== 0) {
      appendLog(
        `platform: xdotool could not activate ${target}: ${failed(activation)}`,
      )
    }
  }

  async notify(title: string, body: string): Promise<void> {
    if (!(await this.hasTool('notify-send'))) {
      appendLog('platform: notify-send is unavailable; notification skipped')
      return
    }
    const result = await this.run('notify-send', [title, body], {
      action: 'notify',
      summary: `notify ${title}: ${body}`,
      details: { title, body },
    })
    if (result.exitCode !== 0) {
      appendLog(`platform: notify-send failed: ${failed(result)}`)
    }
  }

  async playSound(): Promise<void> {
    if (!(await this.hasTool('paplay'))) {
      appendLog('platform: paplay is unavailable; sound skipped')
      return
    }
    const result = await this.run('paplay', [COMPLETE_SOUND], {
      action: 'playSound',
      summary: `playSound ${COMPLETE_SOUND}`,
    })
    if (result.exitCode !== 0) {
      appendLog(`platform: paplay failed: ${failed(result)}`)
    }
  }
}
