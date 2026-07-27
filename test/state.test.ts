import {
  existsSync,
  mkdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onPromptSubmit } from '../src/engine/actions.js'
import {
  armPending,
  gc,
  listSessions,
  setBusy,
  tryTransition,
} from '../src/engine/state.js'
import { sessionDir } from '../src/engine/paths.js'
import {
  config,
  createTestHome,
  event,
  removeTestHome,
} from './helpers.js'

function readState(id: string, name: string): unknown {
  return JSON.parse(readFileSync(join(sessionDir(id), name), 'utf8'))
}

describe('session state', () => {
  let testHome: string

  beforeEach(() => {
    testHome = createTestHome()
  })

  afterEach(() => {
    removeTestHome(testHome)
  })

  it('lets fired win when the timer renames first', () => {
    armPending('session-a', 'nonce-a', 100)

    expect(tryTransition('session-a', 'pending', 'fired', 'nonce-a')).toBe(true)
    expect(tryTransition('session-a', 'pending', 'cancelled')).toBe(false)
    expect(readState('session-a', 'fired')).toEqual({
      nonce: 'nonce-a',
      since: 100,
    })
  })

  it('lets cancelled win and makes the timer a no-op when stop renames first', () => {
    armPending('session-a', 'nonce-a', 100)

    expect(tryTransition('session-a', 'pending', 'cancelled')).toBe(true)
    expect(tryTransition('session-a', 'pending', 'fired', 'nonce-a')).toBe(false)
    expect(existsSync(join(sessionDir('session-a'), 'fired'))).toBe(false)
  })

  it('rejects a stale timer nonce after a new turn is armed', () => {
    armPending('session-a', 'old-nonce', 100)
    armPending('session-a', 'new-nonce', 200)

    expect(tryTransition('session-a', 'pending', 'fired', 'old-nonce')).toBe(false)
    expect(tryTransition('session-a', 'pending', 'fired', 'new-nonce')).toBe(true)
    expect(readState('session-a', 'fired')).toEqual({
      nonce: 'new-nonce',
      since: 200,
    })
  })

  it('overwrites pending state and removes stale outcomes when arming', () => {
    armPending('session-a', 'first', 100)
    expect(tryTransition('session-a', 'pending', 'fired', 'first')).toBe(true)
    writeFileSync(join(sessionDir('session-a'), 'cancelled'), '{}', 'utf8')
    writeFileSync(
      join(sessionDir('session-a'), 'pending'),
      JSON.stringify({ nonce: 'interrupted', since: 150 }),
      'utf8',
    )

    armPending('session-a', 'second', 200)

    expect(existsSync(join(sessionDir('session-a'), 'fired'))).toBe(false)
    expect(existsSync(join(sessionDir('session-a'), 'cancelled'))).toBe(false)
    expect(
      JSON.parse(readFileSync(join(sessionDir('session-a'), 'pending'), 'utf8')),
    ).toEqual({ nonce: 'second', since: 200 })
  })

  it('garbage-collects only sessions older than the requested age', () => {
    const now = Date.now()
    setBusy('meta-old', 'claude', '/old', now - 1_000)
    setBusy('meta-fresh', 'codex', '/fresh', now)

    const fallbackOld = sessionDir('fallback-old')
    mkdirSync(fallbackOld, { recursive: true })
    const oldDate = new Date(now - 1_000)
    utimesSync(fallbackOld, oldDate, oldDate)

    gc(now, 500)

    expect(listSessions()).toEqual(['meta-fresh'])
  })

  it('rejects path traversal in a session id', () => {
    expect(() => sessionDir('../evil')).toThrow(/Invalid session id/)
    expect(() => sessionDir('..')).toThrow(/Invalid session id/)
  })

  it('rate-limits prompt-path garbage collection to once per ten minutes', () => {
    const now = Date.now()
    const staleDate = new Date(now - 2 * 24 * 60 * 60 * 1000)
    const firstStale = sessionDir('stale-before-first-arm')
    mkdirSync(firstStale, { recursive: true })
    utimesSync(firstStale, staleDate, staleDate)
    const spawnTimer = vi.fn(() => ({ unref: vi.fn() }))

    onPromptSubmit(event('session-a', 'prompt-submit'), config(), {
      now: () => now,
      nonce: () => 'nonce-a',
      selfPath: '/tmp/awaitlingo.mjs',
      spawn: spawnTimer,
    })
    expect(existsSync(firstStale)).toBe(false)

    const secondStale = sessionDir('stale-before-second-arm')
    mkdirSync(secondStale, { recursive: true })
    utimesSync(secondStale, staleDate, staleDate)
    onPromptSubmit(event('session-b', 'prompt-submit'), config(), {
      now: () => now + 1_000,
      nonce: () => 'nonce-b',
      selfPath: '/tmp/awaitlingo.mjs',
      spawn: spawnTimer,
    })

    expect(existsSync(secondStale)).toBe(true)
    expect(spawnTimer).toHaveBeenCalledTimes(2)
  })
})
