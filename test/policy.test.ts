import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { onNeedsInput, onStop } from '../src/engine/actions.js'
import { readAway, writeAway } from '../src/engine/away.js'
import { appendLog } from '../src/engine/log.js'
import { logPath, sessionDir } from '../src/engine/paths.js'
import {
  armPending,
  BUSY_STALE_MS,
  clearBusy,
  setBusy,
  tryTransition,
} from '../src/engine/state.js'
import type { Platform } from '../src/platform/index.js'
import type { Config } from '../src/types.js'
import {
  config,
  createTestHome,
  event,
  removeTestHome,
  withoutConductorEnvironment,
} from './helpers.js'

class DryRunPlatform implements Platform {
  readonly actions: string[] = []

  constructor(private readonly frontmost: string | null = 'com.google.Chrome') {}

  async frontmostBundleId(): Promise<string | null> {
    this.actions.push('frontmost')
    return this.frontmost
  }

  async openOrFocusUrl(url: string, browser: Config['browser']): Promise<void> {
    this.actions.push(`open:${browser}:${url}`)
  }

  async activateApp(bundleId: string): Promise<void> {
    const action = `activateApp ${bundleId}`
    this.actions.push(action)
    appendLog(action)
  }

  async notify(title: string, body: string): Promise<void> {
    this.actions.push(`notify ${title}: ${body}`)
  }

  async playSound(): Promise<void> {
    this.actions.push('playSound')
  }
}

function establishThreeSessions(now: number): void {
  setBusy('session-a', 'claude', '/a', now)
  armPending('session-a', 'nonce-a', now)
  expect(tryTransition('session-a', 'pending', 'fired', 'nonce-a')).toBe(true)

  setBusy('session-b', 'codex', '/b', now)
  armPending('session-b', 'nonce-b', now)

  setBusy('session-c', 'claude', '/c', now)
  clearBusy('session-c', now)
  writeAway({ owner: 'session-a', prevApp: 'com.example.editor', since: now })
}

describe('pull-back policy', () => {
  let testHome: string
  let restoreConductorEnvironment: () => void

  beforeEach(() => {
    testHome = createTestHome()
    restoreConductorEnvironment = withoutConductorEnvironment()
  })

  afterEach(() => {
    restoreConductorEnvironment()
    removeTestHome(testHome)
  })

  it('defers all-idle pull-back until the last busy session stops', async () => {
    const now = Date.now()
    establishThreeSessions(now)
    const platform = new DryRunPlatform()

    await onStop(event('session-a', 'stop'), config('all-idle'), platform)

    expect(platform.actions).toEqual([])
    expect(readAway(Date.now())?.owner).toBe('session-a')
    expect(() => readFileSync(logPath(), 'utf8')).toThrow()

    await onStop(event('session-b', 'stop', { harness: 'codex' }), config('all-idle'), platform)

    expect(platform.actions).toContain('activateApp com.example.editor')
    expect(readFileSync(logPath(), 'utf8')).toContain('activateApp com.example.editor')
    expect(readAway(Date.now())).toBeNull()
  })

  it('pulls back immediately when any-finishes is configured', async () => {
    establishThreeSessions(Date.now())
    const platform = new DryRunPlatform()

    await onStop(event('session-a', 'stop'), config('any-finishes'), platform)

    expect(platform.actions).toContain('activateApp com.example.editor')
    expect(readAway(Date.now())).toBeNull()
  })

  it.each([
    ['active non-browser work', 'com.apple.Terminal', false],
    ['a browser', 'com.google.Chrome', true],
    ['an unknown frontmost app', null, true],
  ] as const)(
    'respects prior-art focus etiquette with %s',
    async (_description, frontmost, shouldActivate) => {
      establishThreeSessions(Date.now())
      const platform = new DryRunPlatform(frontmost)

      await onStop(event('session-a', 'stop'), config('any-finishes'), platform)

      expect(platform.actions).toContain(
        'notify awaitlingo: Your coding agent is ready.',
      )
      expect(platform.actions.includes('activateApp com.example.editor')).toBe(
        shouldActivate,
      )
    },
  )

  it('disables every needs-input pull-back and clears stale state', async () => {
    establishThreeSessions(Date.now())
    const platform = new DryRunPlatform()
    const disabledConfig = config('all-idle')
    disabledConfig.pullBack.enabled = false
    disabledConfig.pullBack.sound = true

    await onNeedsInput(event('session-b', 'needs-input'), disabledConfig, platform)

    expect(platform.actions).toEqual([])
    expect(readAway(Date.now())).toBeNull()
    expect(existsSync(join(sessionDir('session-a'), 'fired'))).toBe(false)
    expect(
      JSON.parse(
        readFileSync(join(sessionDir('session-b'), 'meta.json'), 'utf8'),
      ).busySince,
    ).toBeNull()
    for (const outcome of ['pending', 'cancelled', 'fired']) {
      expect(existsSync(join(sessionDir('session-b'), outcome))).toBe(false)
    }
  })

  it('does not pull back for a recursive Claude Stop hook', async () => {
    establishThreeSessions(Date.now())
    const platform = new DryRunPlatform()

    await onStop(
      event('session-a', 'stop', { stopHookActive: true }),
      config('any-finishes'),
      platform,
    )

    expect(platform.actions).toEqual([])
    expect(readAway(Date.now())?.owner).toBe('session-a')
  })

  it('does not let a session stale for 31 minutes block pull-back', async () => {
    const now = Date.now()
    setBusy('session-a', 'claude', '/a', now)
    armPending('session-a', 'nonce-a', now)
    expect(tryTransition('session-a', 'pending', 'fired', 'nonce-a')).toBe(true)
    setBusy('session-b', 'codex', '/b', now - BUSY_STALE_MS - 60_000)
    writeAway({
      owner: 'session-a',
      prevApp: 'com.example.editor',
      since: now,
    })
    const platform = new DryRunPlatform()

    await onStop(event('session-a', 'stop'), config('all-idle'), platform)

    expect(platform.actions).toContain('activateApp com.example.editor')
    expect(readAway(Date.now())).toBeNull()
  })

  it('targets Conductor and suppresses notification and sound when configured', async () => {
    establishThreeSessions(Date.now())
    process.env.CONDUCTOR_SESSION_ID = 'conductor-session'
    const platform = new DryRunPlatform()
    const cfg = config('any-finishes')
    cfg.pullBack.sound = true

    await onStop(event('session-a', 'stop'), cfg, platform)

    expect(platform.actions).toEqual([
      'frontmost',
      'activateApp com.conductor.app',
    ])
  })
})
