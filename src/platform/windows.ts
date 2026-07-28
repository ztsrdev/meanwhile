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
const FOREGROUND_PROCESS_SCRIPT = [
  "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class MeanwhileUser32 { [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId); }'",
  '[uint32]$foregroundProcessId = 0',
  '$window = [MeanwhileUser32]::GetForegroundWindow()',
  'if ($window -eq [IntPtr]::Zero) { exit 1 }',
  '[void][MeanwhileUser32]::GetWindowThreadProcessId($window, [ref]$foregroundProcessId)',
  'if ($foregroundProcessId -eq 0) { exit 1 }',
  '(Get-Process -Id $foregroundProcessId -ErrorAction Stop).ProcessName',
].join('; ')

type Execute = (
  command: string,
  args: readonly string[],
  options: ExecOptions,
) => Promise<ExecResult>

function failed(result: ExecResult): string {
  return result.stderr.trim() || `exit ${result.exitCode}`
}

export function quoteCmdArgument(value: string): string {
  const singleLine = value.replaceAll('\r', '%0D').replaceAll('\n', '%0A')
  return `"${singleLine.replaceAll('"', '""')}"`
}

export function escapePowerShellSingleQuoted(value: string): string {
  return value.replaceAll("'", "''")
}

export function buildAppActivateScript(target: string): string {
  const escaped = escapePowerShellSingleQuoted(target)
  return [
    `$target = '${escaped}'`,
    '$shell = New-Object -ComObject WScript.Shell',
    'if (-not $shell.AppActivate($target)) { exit 1 }',
  ].join('; ')
}

export class WindowsPlatform implements Platform {
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

  async openOrFocusUrl(
    url: string,
    _browser: Config['browser'],
  ): Promise<void> {
    const result = await this.run('cmd', [
      '/c',
      'start',
      '',
      quoteCmdArgument(url),
    ])
    if (result.exitCode !== 0) {
      appendLog(`platform: cmd could not open the URL: ${failed(result)}`)
    }
  }

  async frontmostBundleId(): Promise<string | null> {
    const result = await this.run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      FOREGROUND_PROCESS_SCRIPT,
    ])
    if (result.exitCode !== 0) {
      appendLog(
        `platform: unable to read the foreground Windows process: ${failed(result)}`,
      )
      return null
    }
    if (result.skipped) {
      return null
    }
    return result.stdout.trim().split(/\r?\n/, 1)[0] || null
  }

  async activateApp(target: string): Promise<void> {
    // Windows restricts foreground stealing. AppActivate is best effort and
    // may report success without moving the requested application forward.
    const result = await this.run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      buildAppActivateScript(target),
    ])
    if (result.exitCode !== 0) {
      appendLog(
        `platform: best-effort activation of ${target} failed: ${failed(result)}`,
      )
    }
  }

  async notify(_title: string, _body: string): Promise<void> {
    // Windows toast frameworks require modules that meanwhile does not depend
    // on, so the experimental platform does not claim notification support.
    appendLog('platform: Windows notifications are unavailable; no-op')
  }

  async playSound(): Promise<void> {
    // Keep this paired with notify: no PowerShell modules or runtime packages.
    appendLog('platform: Windows sound playback is unavailable; no-op')
  }
}
