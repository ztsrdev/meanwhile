import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { logPath } from '../src/engine/paths.js'
import {
  buildTabFocusScript,
  DarwinPlatform,
  escapeAppleScript,
  getPlatform,
  NonDarwinPlatform,
  originOf,
  originsMatch,
} from '../src/platform/index.js'
import { createTestHome, removeTestHome } from './helpers.js'

const originalDryRun = process.env.MEANWHILE_DRYRUN

beforeAll(() => {
  process.env.MEANWHILE_DRYRUN = '1'
})

afterAll(() => {
  if (originalDryRun === undefined) {
    delete process.env.MEANWHILE_DRYRUN
  } else {
    process.env.MEANWHILE_DRYRUN = originalDryRun
  }
})

describe('platform helpers', () => {
  it('escapes quotes and backslashes without changing unicode', () => {
    expect(escapeAppleScript('quote " slash \\ café 学習')).toBe(
      'quote \\" slash \\\\ café 学習',
    )
  })

  it('extracts and compares URL origins', () => {
    const learn = 'https://www.duolingo.com/learn'
    const lesson = 'https://www.duolingo.com/lesson/unit-1'

    expect(originOf(learn)).toBe('https://www.duolingo.com')
    expect(originOf(lesson)).toBe('https://www.duolingo.com')
    expect(originsMatch(learn, lesson)).toBe(true)
    expect(originsMatch(learn, 'http://www.duolingo.com/learn')).toBe(false)
    expect(originsMatch(learn, 'https://duolingo.com/learn')).toBe(false)
  })

  it('uses a safe null result for malformed or originless URLs', () => {
    expect(originOf('not a URL')).toBeNull()
    expect(originOf('mailto:learner@example.com')).toBeNull()
    expect(originsMatch('not a URL', 'not a URL')).toBe(false)
  })

  it('builds the verified Chrome tab-focus script', () => {
    expect(buildTabFocusScript('https://www.duolingo.com')).toMatchInlineSnapshot(`
      "tell application "Google Chrome"
        repeat with w in windows
          set tabCount to count of tabs of w
          repeat with i from 1 to tabCount
            set tabUrl to URL of tab i of w
            if tabUrl is "https://www.duolingo.com" or tabUrl starts with "https://www.duolingo.com/" then
              set active tab index of w to i
              set index of w to 1
              activate
              return "focused"
            end if
          end repeat
        end repeat
      end tell
      return "not-found""
    `)
  })
})

describe('platform dry-run behavior', () => {
  let testHome: string

  beforeEach(() => {
    testHome = createTestHome()
  })

  afterEach(() => {
    delete process.env.MEANWHILE_TEST_FAIL_EXEC
    removeTestHome(testHome)
  })

  function logs(): string {
    return readFileSync(logPath(), 'utf8')
  }

  it('selects the implementation for the current operating system', () => {
    const platform = getPlatform()
    if (process.platform === 'darwin') {
      expect(platform).toBeInstanceOf(DarwinPlatform)
    } else {
      expect(platform).toBeInstanceOf(NonDarwinPlatform)
    }
  })

  it('logs every Darwin platform action without executing it', async () => {
    const platform = new DarwinPlatform()

    await expect(platform.frontmostBundleId()).resolves.toBeNull()
    await expect(
      platform.openOrFocusUrl('https://www.duolingo.com/learn', 'default'),
    ).resolves.toBeUndefined()
    await expect(platform.activateApp('com.example.editor')).resolves.toBeUndefined()
    await expect(platform.notify('meanwhile', 'Agent "ready"')).resolves.toBeUndefined()
    await expect(platform.playSound()).resolves.toBeUndefined()

    expect(logs()).toEqual(expect.stringContaining('"command":"osascript"'))
    expect(logs()).toEqual(expect.stringContaining('"command":"open"'))
    expect(logs()).toEqual(expect.stringContaining('com.example.editor'))
    expect(logs()).toEqual(expect.stringContaining('Agent'))
    expect(logs()).toEqual(expect.stringContaining('"command":"afplay"'))
  })

  it('records Chrome and auto browser intentions without launching a browser', async () => {
    const platform = new DarwinPlatform()
    const url = 'https://www.duolingo.com/learn'

    await platform.openOrFocusUrl(url, 'chrome')
    await platform.openOrFocusUrl(url, 'auto')

    const output = logs()
    expect(output).toContain('application \\"Google Chrome\\" is running')
    expect(output).toContain(
      `"args":["-b","com.google.Chrome","${url}"]`,
    )
    expect(output).toContain(`"args":["${url}"]`)
  })

  it('safely falls back for a malformed URL', async () => {
    const platform = new DarwinPlatform()

    await expect(platform.openOrFocusUrl('not a URL', 'chrome')).resolves.toBeUndefined()

    const output = logs()
    expect(output).toContain('URL has no parseable origin')
    expect(output).toContain('"command":"open"')
    expect(output).not.toContain('"command":"osascript"')
  })

  it('logs every non-Darwin action and resolves successfully', async () => {
    const platform = new NonDarwinPlatform()

    await expect(platform.frontmostBundleId()).resolves.toBeNull()
    await expect(
      platform.openOrFocusUrl('https://www.duolingo.com/learn', 'chrome'),
    ).resolves.toBeUndefined()
    await expect(platform.activateApp('com.example.editor')).resolves.toBeUndefined()
    await expect(platform.notify('meanwhile', 'Ready')).resolves.toBeUndefined()
    await expect(platform.playSound()).resolves.toBeUndefined()

    const output = logs()
    expect(output).toContain('"action":"frontmostBundleId"')
    expect(output).toContain('"command":"xdg-open"')
    expect(output).toContain('"action":"activateApp"')
    expect(output).toContain('"command":"notify-send"')
    expect(output).toContain('"action":"playSound"')
  })

  it('falls back and never throws when execFile is forced to fail', async () => {
    process.env.MEANWHILE_TEST_FAIL_EXEC = '1'
    const platform = new DarwinPlatform()
    const url = 'https://www.duolingo.com/learn'

    await expect(platform.openOrFocusUrl(url, 'auto')).resolves.toBeUndefined()
    await expect(platform.frontmostBundleId()).resolves.toBeNull()
    await expect(platform.activateApp('com.example.editor')).resolves.toBeUndefined()
    await expect(platform.notify('meanwhile', 'Ready')).resolves.toBeUndefined()
    await expect(platform.playSound()).resolves.toBeUndefined()

    const output = logs()
    expect(output).toContain('checking whether Google Chrome is running failed')
    expect(output).toContain('"command":"open"')
    expect(output).toContain('reading the frontmost application failed')
    expect(output).toContain('activating application com.example.editor failed')
    expect(output).toContain('showing a notification failed')
    expect(output).toContain('playing the notification sound failed')
  })
})
