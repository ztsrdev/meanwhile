import { CHROME_BUNDLE_ID } from '../constants.js'
import { execute, type DryRunDescription } from '../engine/exec.js'
import { isDryRun } from '../engine/env.js'
import type { Config } from '../types.js'
import { appendLog } from '../engine/log.js'

const EXEC_TIMEOUT_MS = 5_000
const CHROME_RUNNING_SCRIPT = 'application "Google Chrome" is running'
const FRONTMOST_APP_SCRIPT =
  'tell application "System Events" to get bundle identifier of (first application process whose frontmost is true)'

export interface Platform {
  frontmostBundleId(): Promise<string | null>
  openOrFocusUrl(url: string, browser: Config['browser']): Promise<void>
  activateApp(bundleId: string): Promise<void>
  notify(title: string, body: string): Promise<void>
  playSound(): Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function logFailure(action: string, error: unknown): void {
  appendLog(`platform: ${action} failed: ${errorMessage(error)}`)
}

async function invoke(
  command: string,
  args: readonly string[],
  dryRunDescription?: DryRunDescription,
): Promise<string> {
  const description: DryRunDescription = dryRunDescription ?? {
    action: 'execFile',
    summary: [command, ...args].join(' '),
  }
  const result = await execute(command, args, {
    timeoutMs: EXEC_TIMEOUT_MS,
    dryRunDescription: description,
  })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `exit ${result.exitCode}`)
  }
  return result.stdout
}

export function escapeAppleScript(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

export function originOf(value: string): string | null {
  try {
    const origin = new URL(value).origin
    return origin === 'null' ? null : origin
  } catch {
    return null
  }
}

export function originsMatch(left: string, right: string): boolean {
  const leftOrigin = originOf(left)
  return leftOrigin !== null && leftOrigin === originOf(right)
}

export function buildTabFocusScript(origin: string): string {
  const escapedOrigin = escapeAppleScript(origin)
  return [
    'tell application "Google Chrome"',
    '  repeat with w in windows',
    '    set tabCount to count of tabs of w',
    '    repeat with i from 1 to tabCount',
    '      set tabUrl to URL of tab i of w',
    `      if tabUrl is "${escapedOrigin}" or tabUrl starts with "${escapedOrigin}/" then`,
    '        set active tab index of w to i',
    '        set index of w to 1',
    '        activate',
    '        return "focused"',
    '      end if',
    '    end repeat',
    '  end repeat',
    'end tell',
    'return "not-found"',
  ].join('\n')
}

async function openDefault(url: string): Promise<void> {
  try {
    await invoke('open', [url])
  } catch (error) {
    logFailure('opening URL with the default browser', error)
  }
}

async function openChrome(url: string): Promise<void> {
  try {
    await invoke('open', ['-b', CHROME_BUNDLE_ID, url])
  } catch (error) {
    logFailure('opening URL with Google Chrome', error)
    await openDefault(url)
  }
}

export class DarwinPlatform implements Platform {
  async frontmostBundleId(): Promise<string | null> {
    try {
      const output = await invoke('osascript', ['-e', FRONTMOST_APP_SCRIPT])
      return output.trim() || null
    } catch (error) {
      logFailure('reading the frontmost application', error)
      return null
    }
  }

  async openOrFocusUrl(url: string, browser: Config['browser']): Promise<void> {
    if (browser === 'default') {
      await openDefault(url)
      return
    }

    const origin = originOf(url)
    if (origin === null) {
      appendLog('platform: URL has no parseable origin; using the default browser')
      await openDefault(url)
      return
    }

    let chromeRunning: boolean
    try {
      const output = await invoke('osascript', ['-e', CHROME_RUNNING_SCRIPT])
      chromeRunning = output.trim().toLowerCase() === 'true'
    } catch (error) {
      logFailure('checking whether Google Chrome is running', error)
      await openDefault(url)
      return
    }

    if (!chromeRunning) {
      if (browser === 'chrome') {
        await openChrome(url)
      } else {
        await openDefault(url)
      }
      return
    }

    try {
      const output = await invoke('osascript', ['-e', buildTabFocusScript(origin)])
      if (output.trim().toLowerCase() === 'focused') {
        return
      }
    } catch (error) {
      logFailure('focusing an existing Google Chrome tab', error)
      await openDefault(url)
      return
    }

    if (browser === 'chrome') {
      await openChrome(url)
    } else {
      await openDefault(url)
    }
  }

  async activateApp(bundleId: string): Promise<void> {
    try {
      await invoke('osascript', [
        '-e',
        `tell application id "${escapeAppleScript(bundleId)}" to activate`,
      ])
    } catch (error) {
      logFailure(`activating application ${bundleId}`, error)
    }
  }

  async notify(title: string, body: string): Promise<void> {
    try {
      await invoke(
        'osascript',
        [
          '-e',
          `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}"`,
        ],
        {
          action: 'notify',
          summary: `notify ${title}: ${body}`,
          details: { title, body },
        },
      )
    } catch (error) {
      logFailure('showing a notification', error)
    }
  }

  async playSound(): Promise<void> {
    try {
      await invoke('afplay', ['/System/Library/Sounds/Glass.aiff'], {
        action: 'playSound',
        summary: 'playSound',
      })
    } catch (error) {
      logFailure('playing the notification sound', error)
    }
  }
}

export class NonDarwinPlatform implements Platform {
  async frontmostBundleId(): Promise<string | null> {
    if (isDryRun()) {
      appendLog(
        `dryrun: frontmostBundleId ${JSON.stringify({
          action: 'frontmostBundleId',
          result: null,
          platform: process.platform,
        })}`,
      )
    }
    return null
  }

  async openOrFocusUrl(url: string, _browser: Config['browser']): Promise<void> {
    try {
      await invoke('xdg-open', [url])
    } catch (error) {
      logFailure('opening URL with xdg-open', error)
    }
  }

  async activateApp(bundleId: string): Promise<void> {
    if (isDryRun()) {
      appendLog(
        `dryrun: activateApp ${JSON.stringify({
          action: 'activateApp',
          bundleId,
          outcome: 'no-op',
          platform: process.platform,
        })}`,
      )
      return
    }
    appendLog(`platform: activateApp is unavailable on ${process.platform}`)
  }

  async notify(title: string, body: string): Promise<void> {
    try {
      await invoke('notify-send', [title, body], {
        action: 'notify',
        summary: `notify ${title}: ${body}`,
        details: { title, body },
      })
    } catch (error) {
      logFailure('showing a notification with notify-send', error)
    }
  }

  async playSound(): Promise<void> {
    if (isDryRun()) {
      appendLog(
        `dryrun: playSound ${JSON.stringify({
          action: 'playSound',
          outcome: 'no-op',
          platform: process.platform,
        })}`,
      )
      return
    }
    appendLog(`platform: playSound is unavailable on ${process.platform}`)
  }
}

export function getPlatform(): Platform {
  return process.platform === 'darwin' ? new DarwinPlatform() : new NonDarwinPlatform()
}

export type AutomationProbeResult =
  | 'granted'
  | 'denied'
  | 'inconclusive'
  | 'skipped'
  | 'not-applicable'

export async function probeAutomation(): Promise<AutomationProbeResult> {
  if (process.platform !== 'darwin') {
    return 'not-applicable'
  }
  const result = await execute('osascript', ['-e', FRONTMOST_APP_SCRIPT], {
    timeoutMs: EXEC_TIMEOUT_MS,
  })
  if (result.skipped) {
    return 'skipped'
  }
  if (result.exitCode === 0) {
    return 'granted'
  }
  return /not authorized|-1743/i.test(result.stderr)
    ? 'denied'
    : 'inconclusive'
}
