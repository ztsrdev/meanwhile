import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BROWSER_BUNDLE_IDS } from '../src/constants.js'
import type {
  ExecOptions,
  ExecResult,
} from '../src/engine/exec.js'
import { logPath } from '../src/engine/paths.js'
import {
  isX11Session,
  LinuxPlatform,
  parseWmClass,
} from '../src/platform/linux.js'
import { createTestHome, removeTestHome } from './helpers.js'

type Execute = (
  command: string,
  args: readonly string[],
  options: ExecOptions,
) => Promise<ExecResult>

function result(overrides: Partial<ExecResult> = {}): ExecResult {
  return {
    stdout: '',
    stderr: '',
    exitCode: 0,
    skipped: false,
    ...overrides,
  }
}

describe('Linux platform', () => {
  let testHome: string
  let originalDisplay: string | undefined
  let originalWaylandDisplay: string | undefined

  beforeEach(() => {
    testHome = createTestHome()
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    originalDisplay = process.env.DISPLAY
    originalWaylandDisplay = process.env.WAYLAND_DISPLAY
    process.env.DISPLAY = ':99'
    delete process.env.WAYLAND_DISPLAY
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.MEANWHILE_TEST_FAIL_EXEC
    if (originalDisplay === undefined) {
      delete process.env.DISPLAY
    } else {
      process.env.DISPLAY = originalDisplay
    }
    if (originalWaylandDisplay === undefined) {
      delete process.env.WAYLAND_DISPLAY
    } else {
      process.env.WAYLAND_DISPLAY = originalWaylandDisplay
    }
    removeTestHome(testHome)
  })

  function logs(): string {
    return readFileSync(logPath(), 'utf8')
  }

  it('logs the intended X11, browser, notification, and sound commands', async () => {
    const platform = new LinuxPlatform()
    const url = 'https://www.duolingo.com/learn'

    await platform.openOrFocusUrl(url, 'default')
    await expect(platform.frontmostBundleId()).resolves.toBeNull()
    await platform.activateApp('code.Code')
    await platform.notify('meanwhile', 'Agent ready')
    await platform.playSound()

    const output = logs()
    expect(output).toContain(`"command":"xdg-open","args":["${url}"]`)
    expect(output).toContain(
      '"command":"xdotool","args":["getactivewindow"]',
    )
    expect(output).toContain(
      '"command":"xprop","args":["-id","<active-window>","WM_CLASS"]',
    )
    expect(output).toContain(
      '"command":"wmctrl","args":["-x","-a","code.Code"]',
    )
    expect(output).toContain(
      '"command":"notify-send","args":["meanwhile","Agent ready"]',
    )
    expect(output).toContain('"command":"paplay"')
  })

  it('does not issue X11 window commands under Wayland', async () => {
    process.env.WAYLAND_DISPLAY = 'wayland-0'
    const platform = new LinuxPlatform()

    await expect(platform.frontmostBundleId()).resolves.toBeNull()
    await platform.activateApp('code.Code')

    const output = logs()
    expect(output).toContain('unavailable outside X11')
    expect(output).not.toContain('"command":"xdotool"')
    expect(output).not.toContain('"command":"xprop"')
    expect(output).not.toContain('"command":"wmctrl"')
  })

  it('detects X11 only with DISPLAY and without WAYLAND_DISPLAY', () => {
    expect(isX11Session({ DISPLAY: ':0' })).toBe(true)
    expect(
      isX11Session({ DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' }),
    ).toBe(false)
    expect(isX11Session({ DISPLAY: ':0', WAYLAND_DISPLAY: '' })).toBe(false)
    expect(isX11Session({})).toBe(false)
  })

  it.each([
    [
      'WM_CLASS(STRING) = "google-chrome", "Google-chrome"\n',
      'google-chrome.Google-chrome',
    ],
    [
      'WM_CLASS(STRING) = "Navigator", "firefox"\n',
      'Navigator.firefox',
    ],
    [
      'WM_CLASS = "brave-browser", "Brave-browser"\n',
      'brave-browser.Brave-browser',
    ],
    ['WM_CLASS(STRING) = chromium, Chromium\n', 'chromium.Chromium'],
    ['WM_NAME(STRING) = "not a class"\n', null],
    ['WM_CLASS(STRING) = "only-one"\n', null],
  ])('parses captured xprop WM_CLASS output defensively', (fixture, expected) => {
    expect(parseWmClass(fixture)).toBe(expected)
  })

  it('keeps common Linux browser classes in the shared identity set', () => {
    for (const wmClass of [
      'google-chrome.Google-chrome',
      'chromium.Chromium',
      'Navigator.firefox',
      'brave-browser.Brave-browser',
      'vivaldi-stable.Vivaldi-stable',
      'microsoft-edge.Microsoft-edge',
    ]) {
      expect(BROWSER_BUNDLE_IDS.has(wmClass)).toBe(true)
    }
  })

  it('tries Chrome, Chromium, then xdg-open in preference order', async () => {
    const calls: Array<[string, readonly string[]]> = []
    const fakeExecute: Execute = async (command, args) => {
      calls.push([command, args])
      if (
        command === 'which' &&
        (args[0] === 'google-chrome' || args[0] === 'chromium')
      ) {
        return result({ exitCode: 1, stderr: 'not found' })
      }
      return result()
    }
    const platform = new LinuxPlatform(fakeExecute)

    await platform.openOrFocusUrl('https://example.test/a path', 'chrome')

    expect(calls).toEqual([
      ['which', ['google-chrome']],
      ['which', ['chromium']],
      ['which', ['xdg-open']],
      ['xdg-open', ['https://example.test/a path']],
    ])
  })

  it('uses Chromium when Google Chrome is missing', async () => {
    const calls: Array<[string, readonly string[]]> = []
    const fakeExecute: Execute = async (command, args) => {
      calls.push([command, args])
      if (command === 'which' && args[0] === 'google-chrome') {
        return result({ exitCode: 1 })
      }
      return result()
    }
    const platform = new LinuxPlatform(fakeExecute)

    await platform.openOrFocusUrl('https://example.test', 'chrome')

    expect(calls).toEqual([
      ['which', ['google-chrome']],
      ['which', ['chromium']],
      ['chromium', ['https://example.test']],
    ])
  })

  it('falls back to xdotool activation when wmctrl is missing', async () => {
    const calls: Array<[string, readonly string[]]> = []
    const fakeExecute: Execute = async (command, args) => {
      calls.push([command, args])
      if (command === 'which' && args[0] === 'wmctrl') {
        return result({ exitCode: 1 })
      }
      if (command === 'xdotool' && args[0] === 'search') {
        return result({ stdout: '31415\n92653\n' })
      }
      return result()
    }
    const platform = new LinuxPlatform(fakeExecute)

    await platform.activateApp('code.Code')

    expect(calls).toEqual([
      ['which', ['wmctrl']],
      ['which', ['xdotool']],
      ['xdotool', ['search', '--class', 'code.Code']],
      ['xdotool', ['windowactivate', '31415']],
    ])
  })
})
