import { randomUUID } from 'node:crypto'
import { spawn, type SpawnOptions } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BROWSER_BUNDLE_IDS,
  CONDUCTOR_BUNDLE_ID,
} from '../constants.js'
import type { AwayState, Config, NormalizedEvent } from '../types.js'
import type { Platform } from '../platform/index.js'
import {
  clearAway,
  createAway,
  readAway,
  touchAway,
  writeAway,
} from './away.js'
import { underConductor } from './env.js'
import { atomicWriteFile } from './fs.js'
import { stateDir } from './paths.js'
import {
  armPending,
  clearBusy,
  clearOutcome,
  gc,
  otherSessionsBusy,
  removeSession,
  setBusy,
  tryTransition,
} from './state.js'

export const GC_INTERVAL_MS = 10 * 60 * 1000

type SpawnLike = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => { unref(): void }

export interface PromptSubmitDeps {
  spawn?: SpawnLike
  selfPath?: string
  now?: () => number
  nonce?: () => string
}

function gcIfDue(now: number): void {
  const path = join(stateDir(), 'last-gc')
  try {
    const lastGc = Number(readFileSync(path, 'utf8').trim())
    if (
      Number.isFinite(lastGc) &&
      now >= lastGc &&
      now - lastGc < GC_INTERVAL_MS
    ) {
      return
    }
  } catch {
    // A missing or corrupt timestamp makes GC due.
  }

  atomicWriteFile(path, `${now}\n`)
  gc(now)
}

async function pullBack(
  away: { prevApp: string | null },
  cfg: Config,
  platform: Platform,
  body: string,
): Promise<void> {
  const conductor = underConductor()
  const target = conductor ? CONDUCTOR_BUNDLE_ID : away.prevApp
  if (target) {
    const frontmost = await platform.frontmostBundleId()
    const userAlreadyReturned =
      frontmost !== null &&
      frontmost !== target &&
      !BROWSER_BUNDLE_IDS.has(frontmost)
    if (!userAlreadyReturned && frontmost !== target) {
      await platform.activateApp(target)
    }
  }

  const suppressAlerts = conductor && cfg.conductor.suppressAlerts
  if (!suppressAlerts) {
    const alerts: Array<Promise<void>> = []
    if (cfg.pullBack.notification) {
      alerts.push(platform.notify('meanwhile', body))
    }
    if (cfg.pullBack.sound) {
      alerts.push(platform.playSound())
    }
    await Promise.all(alerts)
  }
}

async function settleAway(
  away: AwayState,
  ev: NormalizedEvent,
  cfg: Config,
  platform: Platform,
  body: string,
): Promise<void> {
  if (cfg.pullBack.enabled) {
    await pullBack(away, cfg, platform, body)
  }
  clearAway(away.owner)
  clearOutcome(away.owner)
  if (away.owner !== ev.sessionId) {
    clearOutcome(ev.sessionId)
  }
}

export function onPromptSubmit(
  ev: NormalizedEvent,
  cfg: Config,
  deps: PromptSubmitDeps = {},
): void {
  const now = (deps.now ?? Date.now)()
  const nonce = (deps.nonce ?? randomUUID)()
  const selfPath = deps.selfPath ?? process.argv[1]
  if (!selfPath) {
    throw new Error('Unable to resolve the meanwhile entry script')
  }

  gcIfDue(now)
  setBusy(ev.sessionId, ev.harness, ev.cwd, now)
  armPending(ev.sessionId, nonce, now)

  const spawnTimer = deps.spawn ?? spawn
  spawnTimer(
    process.execPath,
    [
      selfPath,
      'timer',
      '--session',
      ev.sessionId,
      '--nonce',
      nonce,
      '--delay',
      String(cfg.delaySeconds),
    ],
    { detached: true, stdio: 'ignore', windowsHide: true },
  ).unref()
}

export async function onTimerFire(
  sessionId: string,
  nonce: string,
  cfg: Config,
  platform: Platform,
): Promise<void> {
  if (!tryTransition(sessionId, 'pending', 'fired', nonce)) {
    return
  }

  const now = Date.now()
  if (readAway(now)) {
    touchAway(now)
    return
  }

  if (!createAway({ owner: sessionId, prevApp: null, since: now })) {
    touchAway(now)
    return
  }

  const prevApp = await platform.frontmostBundleId()
  await platform.openOrFocusUrl(cfg.url, cfg.browser)
  const claimed = readAway(Date.now(), Number.POSITIVE_INFINITY)
  if (claimed?.owner === sessionId) {
    writeAway({ ...claimed, prevApp })
  }
}

export async function onStop(
  ev: NormalizedEvent,
  cfg: Config,
  platform: Platform,
): Promise<void> {
  const now = Date.now()
  clearBusy(ev.sessionId, now)
  tryTransition(ev.sessionId, 'pending', 'cancelled')
  if (ev.stopHookActive) {
    return
  }

  const away = readAway(now)
  if (!away || !cfg.pullBack.enabled) {
    return
  }

  const anotherSessionIsBusy = otherSessionsBusy(ev.sessionId, now)
  const ownsAway = away.owner === ev.sessionId
  const completesDeferredAllIdle =
    cfg.pullBack.multiSession === 'all-idle' && !anotherSessionIsBusy
  if (!ownsAway && !completesDeferredAllIdle) {
    return
  }
  if (cfg.pullBack.multiSession === 'all-idle' && anotherSessionIsBusy) {
    return
  }

  await settleAway(
    away,
    ev,
    cfg,
    platform,
    'Your coding agent is ready.',
  )
}

export async function onNeedsInput(
  ev: NormalizedEvent,
  cfg: Config,
  platform: Platform,
): Promise<void> {
  const now = Date.now()
  clearBusy(ev.sessionId, now)
  tryTransition(ev.sessionId, 'pending', 'cancelled')

  const away = readAway(now)
  if (!away) {
    return
  }

  await settleAway(
    away,
    ev,
    cfg,
    platform,
    'Your coding agent needs input.',
  )
}

export function onSessionEnd(ev: NormalizedEvent): void {
  removeSession(ev.sessionId)
  gc(Date.now())
}
