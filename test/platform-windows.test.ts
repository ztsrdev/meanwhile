import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BROWSER_BUNDLE_IDS } from '../src/constants.js'
import { logPath } from '../src/engine/paths.js'
import {
  buildAppActivateScript,
  escapePowerShellSingleQuoted,
  quoteCmdArgument,
  WindowsPlatform,
} from '../src/platform/windows.js'
import { createTestHome, removeTestHome } from './helpers.js'

describe('Windows platform', () => {
  let testHome: string

  beforeEach(() => {
    testHome = createTestHome()
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.MEANWHILE_TEST_FAIL_EXEC
    removeTestHome(testHome)
  })

  function logs(): string {
    return readFileSync(logPath(), 'utf8')
  }

  it('quotes cmd and PowerShell values with spaces and quotes', () => {
    expect(
      quoteCmdArgument(
        'https://example.test/a path?label="two words"&next=/learn',
      ),
    ).toBe(
      '"https://example.test/a path?label=""two words""&next=/learn"',
    )
    expect(escapePowerShellSingleQuoted("Visual Studio's Window")).toBe(
      "Visual Studio''s Window",
    )
    expect(buildAppActivateScript("Visual Studio's Window")).toContain(
      "$target = 'Visual Studio''s Window'",
    )
  })

  it('recognizes common Windows browser process names', () => {
    for (const processName of [
      'chrome',
      'chromium',
      'firefox',
      'brave',
      'vivaldi',
      'msedge',
    ]) {
      expect(BROWSER_BUNDLE_IDS.has(processName)).toBe(true)
    }
  })

  it('logs cmd start and best-effort AppActivate command shapes', async () => {
    const platform = new WindowsPlatform()
    const url =
      'https://example.test/a path?label="two words"&next=/learn'

    await platform.openOrFocusUrl(url, 'chrome')
    await platform.activateApp("Visual Studio's Window")
    await platform.notify('meanwhile', 'Ready')
    await platform.playSound()

    const output = logs()
    expect(output).toContain('"command":"cmd"')
    expect(output).toContain(
      `"args":["/c","start","","${quoteCmdArgument(url).replaceAll('"', '\\"')}"]`,
    )
    expect(output).toContain('"command":"powershell.exe"')
    expect(output).toContain("Visual Studio''s Window")
    expect(output).toContain('AppActivate')
    expect(output).toContain('Windows notifications are unavailable')
    expect(output).toContain('Windows sound playback is unavailable')
  })

  it('returns null when foreground process detection fails', async () => {
    process.env.MEANWHILE_TEST_FAIL_EXEC = '1'
    const platform = new WindowsPlatform()

    await expect(platform.frontmostBundleId()).resolves.toBeNull()

    expect(logs()).toContain(
      'unable to read the foreground Windows process',
    )
  })
})
