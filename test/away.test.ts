import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AWAY_MAX_AGE_MS,
  clearAway,
  createAway,
  readAway,
  writeAway,
} from '../src/engine/away.js'
import { awayPath } from '../src/engine/paths.js'
import { armPending } from '../src/engine/state.js'
import { onTimerFire } from '../src/engine/actions.js'
import type { Platform } from '../src/platform/index.js'
import type { Config } from '../src/types.js'
import { config, createTestHome, removeTestHome } from './helpers.js'

class RecordingPlatform implements Platform {
  readonly actions: string[] = []

  async frontmostBundleId(): Promise<string | null> {
    this.actions.push('frontmost')
    return 'com.example.editor'
  }

  async openOrFocusUrl(url: string, browser: Config['browser']): Promise<void> {
    this.actions.push(`open:${browser}:${url}`)
  }

  async activateApp(bundleId: string): Promise<void> {
    this.actions.push(`activate:${bundleId}`)
  }

  async notify(title: string, body: string): Promise<void> {
    this.actions.push(`notify:${title}:${body}`)
  }

  async playSound(): Promise<void> {
    this.actions.push('sound')
  }
}

describe('away state', () => {
  let testHome: string

  beforeEach(() => {
    testHome = createTestHome()
  })

  afterEach(() => {
    removeTestHome(testHome)
  })

  it('can only be cleared by its owner', () => {
    writeAway({ owner: 'session-a', prevApp: 'com.example.editor', since: 100 })

    clearAway('session-b')
    expect(readAway(100)).toEqual({
      owner: 'session-a',
      prevApp: 'com.example.editor',
      since: 100,
    })

    clearAway('session-a')
    expect(readAway(100)).toBeNull()
  })

  it('expires markers older than the maximum age', () => {
    writeAway({ owner: 'session-a', prevApp: null, since: 100 })

    expect(readAway(201, 100)).toBeNull()
    expect(readAway(200, 100)).not.toBeNull()
  })

  it('returns null for a corrupt marker', () => {
    mkdirSync(dirname(awayPath()), { recursive: true })
    writeFileSync(awayPath(), '{not-json', 'utf8')

    expect(readAway(Date.now())).toBeNull()
  })

  it('lets only one concurrent creator claim the away marker', () => {
    const now = Date.now()

    expect(
      createAway({ owner: 'session-a', prevApp: null, since: now }),
    ).toBe(true)
    expect(
      createAway({ owner: 'session-b', prevApp: null, since: now }),
    ).toBe(false)
    expect(readAway(now)?.owner).toBe('session-a')
  })

  it('replaces an expired marker with an exclusive create', () => {
    const now = Date.now()
    writeAway({
      owner: 'expired-session',
      prevApp: null,
      since: now - AWAY_MAX_AGE_MS - 1,
    })

    expect(
      createAway({ owner: 'new-session', prevApp: null, since: now }),
    ).toBe(true)
    expect(readAway(now)?.owner).toBe('new-session')
  })

  it('refreshes an existing marker without reopening for a second session', async () => {
    const before = Date.now()
    writeAway({ owner: 'session-a', prevApp: 'com.example.editor', since: before })
    armPending('session-b', 'nonce-b', before)
    const platform = new RecordingPlatform()

    await onTimerFire('session-b', 'nonce-b', config(), platform)

    const refreshed = readAway(Date.now())
    expect(refreshed?.owner).toBe('session-a')
    expect(refreshed?.prevApp).toBe('com.example.editor')
    expect(refreshed?.since).toBeGreaterThanOrEqual(before)
    expect(platform.actions).toEqual([])
  })
})
